package main

import (
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type SidecarProcess struct {
	cmd *exec.Cmd
}

type sidecarCommand struct {
	command string
	args    []string
	dir     string
	mode    string
}

func spawnNodeSidecar(port int, token string) (*SidecarProcess, error) {
	spec, err := resolveSidecarCommand()
	if err != nil {
		return nil, err
	}

	cmd := exec.Command(spec.command, spec.args...)
	cmd.Dir = spec.dir
	cmd.Env = sidecarEnv(port, token)
	output := processOutput()
	cmd.Stdout = output
	cmd.Stderr = output
	configureCommand(cmd)

	if err := cmd.Start(); err != nil {
		return nil, userError("启动本地服务失败：" + err.Error())
	}
	logLine("CodexPanel sidecar started:", spec.mode, "pid", cmd.Process.Pid)
	return &SidecarProcess{cmd: cmd}, nil
}

func (process *SidecarProcess) Wait() error {
	if process == nil || process.cmd == nil {
		return nil
	}
	return process.cmd.Wait()
}

func stopSidecar(process *SidecarProcess, port int) {
	if process != nil && process.cmd != nil && process.cmd.Process != nil {
		killProcessTree(process.cmd.Process.Pid)
		_ = process.cmd.Process.Kill()
	}
	killSidecarOrphans()
	if port > 0 {
		waitForPortRelease(port, 5*time.Second)
	}
}

func sidecarEnv(port int, token string) []string {
	env := os.Environ()
	env = appendEnv(env, "PORT", intString(port))
	env = appendEnv(env, "MOBILE_TYPER_TOKEN", token)
	env = appendEnv(env, "CODEX_APP_NAME", "CodexPanel")
	env = appendEnv(env, "CODEX_OPEN_BROWSER", "0")
	if remoteKey := configuredRemoteKey(); remoteKey != "" {
		env = appendEnv(env, "CODEX_REMOTE_KEY", remoteKey)
	}
	if relayURL := configuredRelayURL(); relayURL != "" {
		env = appendEnv(env, "CODEX_RELAY_URL", relayURL)
	}
	return env
}

func appendEnv(env []string, key string, value string) []string {
	prefix := key + "="
	filtered := env[:0]
	for _, item := range env {
		if !strings.HasPrefix(item, prefix) {
			filtered = append(filtered, item)
		}
	}
	return append(filtered, prefix+value)
}

func resolveSidecarCommand() (sidecarCommand, error) {
	if configured := strings.TrimSpace(os.Getenv("CODEXPANEL_NODE_SIDECAR")); configured != "" {
		if exists(configured) {
			return sidecarCommand{
				command: configured,
				dir:     filepath.Dir(configured),
				mode:    "configured sidecar",
			}, nil
		}
	}

	sidecarName := "codexpanel-node-sidecar"
	if runtime.GOOS == "windows" {
		sidecarName += ".exe"
	}
	for _, dir := range candidateDirs() {
		candidate := filepath.Join(dir, sidecarName)
		if exists(candidate) {
			return sidecarCommand{
				command: candidate,
				dir:     dir,
				mode:    "portable sidecar",
			}, nil
		}
	}

	node, err := exec.LookPath("node")
	if err != nil {
		return sidecarCommand{}, userError("未找到 Node.js，也没有找到 codexpanel-node-sidecar。请先安装 Node.js 或使用完整便携包。")
	}
	for _, dir := range candidateDirs() {
		serverPath := filepath.Join(dir, "server.js")
		if exists(serverPath) {
			return sidecarCommand{
				command: node,
				args:    []string{serverPath},
				dir:     dir,
				mode:    "node server.js",
			}, nil
		}
	}

	return sidecarCommand{}, userError("未找到 server.js 或 codexpanel-node-sidecar，本地服务无法启动。")
}

func candidateDirs() []string {
	var dirs []string
	add := func(dir string) {
		if dir == "" {
			return
		}
		abs, err := filepath.Abs(dir)
		if err != nil {
			return
		}
		for _, existing := range dirs {
			if samePath(existing, abs) {
				return
			}
		}
		dirs = append(dirs, abs)
	}

	if cwd, err := os.Getwd(); err == nil {
		add(cwd)
		add(filepath.Join(cwd, "build", "bin"))
	}
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		add(exeDir)
		add(filepath.Dir(exeDir))
		add(filepath.Dir(filepath.Dir(exeDir)))
	}
	return dirs
}

func exists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func samePath(left string, right string) bool {
	leftAbs, leftErr := filepath.Abs(left)
	rightAbs, rightErr := filepath.Abs(right)
	if leftErr != nil || rightErr != nil {
		return left == right
	}
	if runtime.GOOS == "windows" {
		return strings.EqualFold(leftAbs, rightAbs)
	}
	return leftAbs == rightAbs
}

func waitForHealth(port int, token string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if healthOK(port, token) {
			return true
		}
		time.Sleep(250 * time.Millisecond)
	}
	return false
}

func healthOK(port int, token string) bool {
	client := &http.Client{
		Timeout: 700 * time.Millisecond,
		Transport: &http.Transport{
			DialContext: (&net.Dialer{
				Timeout: 500 * time.Millisecond,
			}).DialContext,
			DisableKeepAlives: true,
		},
	}

	url := "http://127.0.0.1:" + intString(port) + "/codex/health?token=" + token
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	req.Header.Set("Connection", "close")

	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode == http.StatusOK
}

func commandExited(err error) bool {
	if err == nil {
		return true
	}
	var exitErr *exec.ExitError
	return errors.As(err, &exitErr)
}
