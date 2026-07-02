package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

var appVersion = "0.0.0-dev"

const githubLatestReleaseAPI = "https://api.github.com/repos/wintopic/CodexPanel/releases/latest"

type UpdateStatus struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	Platform       string `json:"platform"`
	Available      bool   `json:"available"`
	Checking       bool   `json:"checking"`
	Downloading    bool   `json:"downloading"`
	Downloaded     bool   `json:"downloaded"`
	CanInstall     bool   `json:"canInstall"`
	AssetName      string `json:"assetName"`
	ReleaseURL     string `json:"releaseUrl"`
	DownloadPath   string `json:"downloadPath"`
	Message        string `json:"message"`
	Progress       int    `json:"progress"`
	LastCheckedAt  string `json:"lastCheckedAt"`
}

type UpdateManager struct {
	mu             sync.Mutex
	client         *http.Client
	status         UpdateStatus
	assetURL       string
	assetSize      int64
	installStarted bool
}

type githubRelease struct {
	TagName string        `json:"tag_name"`
	Name    string        `json:"name"`
	HTMLURL string        `json:"html_url"`
	Assets  []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

func NewUpdateManager(currentVersion string) *UpdateManager {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = systemProxy
	return &UpdateManager{
		client: &http.Client{
			Transport: transport,
			Timeout:   45 * time.Second,
		},
		status: UpdateStatus{
			CurrentVersion: cleanVersion(currentVersion),
			Platform:       runtime.GOOS,
			CanInstall:     runtime.GOOS == "windows",
			Message:        "准备检查",
		},
	}
}

func (u *UpdateManager) Status() UpdateStatus {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.status
}

func (u *UpdateManager) Check(ctx context.Context) (*UpdateStatus, error) {
	u.mu.Lock()
	if u.status.Checking {
		status := u.status
		u.mu.Unlock()
		return &status, nil
	}
	u.status.Checking = true
	u.status.Message = "正在检查更新"
	u.mu.Unlock()

	release, err := u.fetchLatestRelease(ctx)
	u.mu.Lock()
	defer u.mu.Unlock()
	u.status.Checking = false
	u.status.LastCheckedAt = time.Now().Format(time.RFC3339)
	if err != nil {
		u.status.Message = "检查更新失败：" + err.Error()
		status := u.status
		return &status, err
	}

	asset, latestVersion, ok := selectReleaseAsset(release)
	if !ok {
		u.assetURL = ""
		u.assetSize = 0
		u.status.Available = false
		u.status.Downloaded = false
		u.status.AssetName = ""
		u.status.LatestVersion = ""
		u.status.ReleaseURL = release.HTMLURL
		u.status.Message = "没有找到适用于当前系统的发布包"
		status := u.status
		return &status, nil
	}

	current := cleanVersion(u.status.CurrentVersion)
	latest := cleanVersion(latestVersion)
	u.assetURL = asset.BrowserDownloadURL
	u.assetSize = asset.Size
	u.status.AssetName = asset.Name
	u.status.LatestVersion = latest
	u.status.ReleaseURL = release.HTMLURL
	u.status.Progress = 0
	u.status.Available = compareVersions(latest, current) > 0
	u.status.DownloadPath = updateDownloadPath(asset.Name)
	u.status.Downloaded = fileExists(u.status.DownloadPath)
	if u.status.Available {
		if u.status.Downloaded {
			u.status.Progress = 100
			u.status.Message = "更新已下载，重启后安装"
		} else {
			u.status.Message = "发现新版本 " + latest
		}
	} else {
		u.status.Downloaded = false
		u.status.DownloadPath = ""
		u.status.Message = "已是最新版本"
	}
	status := u.status
	return &status, nil
}

func (u *UpdateManager) CheckAndDownload(ctx context.Context) {
	status, err := u.Check(ctx)
	if err != nil || status == nil || !status.Available || status.Downloaded {
		return
	}
	if _, err := u.Download(ctx); err != nil {
		logLine("Auto update download failed:", err.Error())
	}
}

func (u *UpdateManager) Download(ctx context.Context) (*UpdateStatus, error) {
	u.mu.Lock()
	if u.status.Downloading {
		status := u.status
		u.mu.Unlock()
		return &status, nil
	}
	assetURL := u.assetURL
	assetName := u.status.AssetName
	if !u.status.Available || assetURL == "" || assetName == "" {
		u.mu.Unlock()
		if status, err := u.Check(ctx); err != nil || status == nil || !status.Available {
			return status, err
		}
		u.mu.Lock()
		assetURL = u.assetURL
		assetName = u.status.AssetName
	}
	target := updateDownloadPath(assetName)
	if fileExists(target) {
		u.status.Downloaded = true
		u.status.DownloadPath = target
		u.status.Progress = 100
		u.status.Message = "更新已下载，重启后安装"
		status := u.status
		u.mu.Unlock()
		return &status, nil
	}
	u.status.Downloading = true
	u.status.Downloaded = false
	u.status.Progress = 0
	u.status.Message = "正在下载更新"
	u.status.DownloadPath = target
	u.mu.Unlock()

	err := u.downloadFile(ctx, assetURL, target)
	u.mu.Lock()
	defer u.mu.Unlock()
	u.status.Downloading = false
	if err != nil {
		u.status.Message = "下载更新失败：" + err.Error()
		status := u.status
		return &status, err
	}
	u.status.Downloaded = true
	u.status.Progress = 100
	u.status.Message = "更新已下载，重启后安装"
	status := u.status
	return &status, nil
}

func (u *UpdateManager) InstallDownloaded() (*UpdateStatus, error) {
	u.mu.Lock()
	if u.installStarted {
		u.status.Message = "更新安装已启动"
		status := u.status
		u.mu.Unlock()
		return &status, nil
	}
	path := u.status.DownloadPath
	if !u.status.Downloaded || path == "" {
		status := u.status
		u.mu.Unlock()
		return &status, userError("更新包尚未下载完成。")
	}
	u.mu.Unlock()

	if runtime.GOOS != "windows" {
		return nil, userError("当前系统暂不支持自动安装，请使用下载的发布包手动更新。")
	}
	if !fileExists(path) {
		return nil, userError("更新包不存在，请重新下载。")
	}
	cmd := exec.Command(path, "/SP-", "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS")
	configureCommand(cmd)
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	u.mu.Lock()
	u.installStarted = true
	u.status.Message = "更新安装已启动"
	status := u.status
	u.mu.Unlock()
	return &status, nil
}

func (u *UpdateManager) InstallOnExit() {
	u.mu.Lock()
	ready := runtime.GOOS == "windows" && u.status.Downloaded && u.status.DownloadPath != "" && !u.installStarted
	u.mu.Unlock()
	if ready {
		if _, err := u.InstallDownloaded(); err != nil {
			logLine("Install update on exit failed:", err.Error())
		}
	}
}

func (u *UpdateManager) fetchLatestRelease(ctx context.Context) (*githubRelease, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, githubLatestReleaseAPI, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("accept", "application/vnd.github+json")
	req.Header.Set("user-agent", "CodexPanel/"+cleanVersion(appVersion))
	resp, err := u.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("GitHub Releases 返回 %s", resp.Status)
	}
	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, err
	}
	return &release, nil
}

func (u *UpdateManager) downloadFile(ctx context.Context, url string, target string) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("user-agent", "CodexPanel/"+cleanVersion(appVersion))
	resp, err := u.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("下载返回 %s", resp.Status)
	}

	partial := target + ".download"
	file, err := os.Create(partial)
	if err != nil {
		return err
	}
	defer file.Close()

	total := resp.ContentLength
	if total <= 0 {
		total = u.assetSize
	}
	var written int64
	buffer := make([]byte, 256*1024)
	for {
		n, readErr := resp.Body.Read(buffer)
		if n > 0 {
			if _, err := file.Write(buffer[:n]); err != nil {
				return err
			}
			written += int64(n)
			if total > 0 {
				progress := int((written * 100) / total)
				if progress > 99 {
					progress = 99
				}
				u.mu.Lock()
				u.status.Progress = progress
				u.mu.Unlock()
			}
		}
		if readErr == nil {
			continue
		}
		if readErr == io.EOF {
			break
		}
		return readErr
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(partial, target)
}

func selectReleaseAsset(release *githubRelease) (githubAsset, string, bool) {
	if release == nil {
		return githubAsset{}, "", false
	}
	var targetName string
	switch runtime.GOOS {
	case "windows":
		setupPattern := regexp.MustCompile(`^CodexPanel-Setup-(.+)\.exe$`)
		for _, asset := range release.Assets {
			if match := setupPattern.FindStringSubmatch(asset.Name); len(match) == 2 && asset.BrowserDownloadURL != "" {
				return asset, match[1], true
			}
		}
		targetName = "CodexPanel-Windows.zip"
	case "linux":
		targetName = "CodexPanel-Linux.tar.gz"
	case "darwin":
		targetName = "CodexPanel-macOS.tar.gz"
	default:
		return githubAsset{}, "", false
	}
	for _, asset := range release.Assets {
		if asset.Name == targetName && asset.BrowserDownloadURL != "" {
			return asset, versionFromRelease(release), true
		}
	}
	return githubAsset{}, "", false
}

func versionFromRelease(release *githubRelease) string {
	if release == nil {
		return "0.0.0"
	}
	version := versionFromReleaseTag(release.TagName)
	if version != "0.0.0" {
		return version
	}
	setupPattern := regexp.MustCompile(`^CodexPanel-Setup-(.+)\.exe$`)
	for _, asset := range release.Assets {
		if match := setupPattern.FindStringSubmatch(asset.Name); len(match) == 2 {
			return cleanVersion(match[1])
		}
	}
	return version
}

func versionFromReleaseTag(tag string) string {
	version := cleanVersion(tag)
	if version == "" || version == "latest" {
		return "0.0.0"
	}
	return version
}

func updateDownloadPath(assetName string) string {
	dir, err := os.UserCacheDir()
	if err != nil || dir == "" {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "CodexPanel", "updates", filepath.Base(assetName))
}

func fileExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func cleanVersion(value string) string {
	value = strings.TrimSpace(strings.TrimPrefix(value, "v"))
	if value == "" {
		return "0.0.0"
	}
	return value
}

func compareVersions(a string, b string) int {
	left := versionParts(a)
	right := versionParts(b)
	max := len(left)
	if len(right) > max {
		max = len(right)
	}
	for i := 0; i < max; i++ {
		var lv, rv int
		if i < len(left) {
			lv = left[i]
		}
		if i < len(right) {
			rv = right[i]
		}
		if lv > rv {
			return 1
		}
		if lv < rv {
			return -1
		}
	}
	return 0
}

func versionParts(value string) []int {
	value = cleanVersion(value)
	fields := regexp.MustCompile(`[^0-9]+`).Split(value, -1)
	parts := make([]int, 0, len(fields))
	for _, field := range fields {
		if field == "" {
			continue
		}
		number, err := strconv.Atoi(field)
		if err != nil {
			continue
		}
		parts = append(parts, number)
	}
	if len(parts) == 0 {
		return []int{0}
	}
	return parts
}
