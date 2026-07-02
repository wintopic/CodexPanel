package main

import (
	"context"
	"strings"
	"sync"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx   context.Context
	mu    sync.Mutex
	cmd   *SidecarProcess
	port  int
	token string
}

const sidecarHealthTimeout = 30 * time.Second

type ServiceControlResponse struct {
	OK         bool   `json:"ok"`
	Action     string `json:"action"`
	Port       int    `json:"port"`
	Token      string `json:"token"`
	ControlURL string `json:"control_url"`
	Message    string `json:"message"`
}

func NewApp() *App {
	port := configuredPort()
	if port <= 0 {
		port = findAvailablePort(8787, 20)
	}
	if port <= 0 {
		port = 8787
	}

	token := configuredToken()
	if token == "" {
		token = generateToken()
	}

	return &App{
		port:  port,
		token: token,
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	wailsruntime.WindowCenter(ctx)
	wailsruntime.WindowSetMinSize(ctx, 760, 392)
	wailsruntime.WindowSetMaxSize(ctx, 760, 392)

	if err := a.startService(); err != nil {
		logLine("Start local service failed:", err.Error())
	}
}

func (a *App) shutdown(ctx context.Context) {
	a.stopService()
}

func (a *App) GetControlToken() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.token
}

func (a *App) ControlService(action string) (*ServiceControlResponse, error) {
	action = strings.ToLower(strings.TrimSpace(action))
	if action != "start" && action != "stop" {
		return nil, userError("不支持的服务操作。")
	}

	if action == "stop" {
		port, hadChild := a.stopService()
		message := "本地服务已经停止。"
		if hadChild {
			message = "本地服务已停止。"
		}
		return a.serviceResponse(action, port, true, message), nil
	}

	port, token, running := a.snapshot()
	if action == "start" && running && healthOK(port, token) {
		return a.serviceResponse(action, port, true, "本地服务已经在运行。"), nil
	}

	if running {
		a.stopService()
	}

	if err := a.startService(); err != nil {
		return nil, err
	}

	port, token, _ = a.snapshot()
	healthy := waitForHealth(port, token, sidecarHealthTimeout)
	message := "已发起服务操作，但健康检查暂未完成。"
	if healthy {
		message = "本地服务已启动。"
	}
	return a.serviceResponse(action, port, healthy, message), nil
}

func (a *App) serviceResponse(action string, port int, ok bool, message string) *ServiceControlResponse {
	a.mu.Lock()
	token := a.token
	a.mu.Unlock()
	return &ServiceControlResponse{
		OK:         ok,
		Action:     action,
		Port:       port,
		Token:      token,
		ControlURL: "",
		Message:    message,
	}
}

func (a *App) currentPort() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.port
}

func (a *App) snapshot() (int, string, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.port, a.token, a.cmd != nil
}

func (a *App) startService() error {
	a.mu.Lock()
	if a.cmd != nil && healthOK(a.port, a.token) {
		a.mu.Unlock()
		return nil
	}
	token := a.token
	a.mu.Unlock()

	port := configuredPort()
	if port <= 0 {
		port = findAvailablePort(8787, 20)
	}
	if port <= 0 {
		port = 8787
	}

	child, err := spawnNodeSidecar(port, token)
	if err != nil {
		return err
	}

	a.mu.Lock()
	a.cmd = child
	a.port = port
	a.mu.Unlock()

	go func() {
		err := child.Wait()
		if err != nil {
			logLine("CodexPanel sidecar exited:", err.Error())
		}
		a.mu.Lock()
		if a.cmd == child {
			a.cmd = nil
		}
		a.mu.Unlock()
	}()

	waitForHealth(port, token, sidecarHealthTimeout)
	return nil
}

func (a *App) stopService() (int, bool) {
	a.mu.Lock()
	child := a.cmd
	a.cmd = nil
	port := a.port
	a.mu.Unlock()

	hadChild := child != nil
	stopSidecar(child, port)
	return port, hadChild
}
