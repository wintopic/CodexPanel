package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type appError string

func (err appError) Error() string {
	return string(err)
}

func userError(message string) error {
	return appError(message)
}

func intString(value int) string {
	return strconv.Itoa(value)
}

func configuredPort() int {
	if port := parsePort(os.Getenv("PORT")); port > 0 && portAvailable(port) {
		return port
	}
	if value, ok := savedControlValue("port"); ok {
		if port := parseSavedPort(value); port > 0 && portAvailable(port) {
			return port
		}
	}
	return 0
}

func configuredToken() string {
	return strings.TrimSpace(os.Getenv("MOBILE_TYPER_TOKEN"))
}

func configuredRemoteKey() string {
	if value := normalizeRemoteKey(os.Getenv("CODEX_REMOTE_KEY")); value != "" {
		return value
	}
	if value, ok := savedControlValue("remoteKey"); ok {
		if text, ok := value.(string); ok {
			return normalizeRemoteKey(text)
		}
	}
	return ""
}

func configuredRelayURL() string {
	if value := normalizeNonEmpty(os.Getenv("CODEX_RELAY_URL")); value != "" {
		return value
	}
	if value, ok := savedControlValue("relayUrl"); ok {
		if text, ok := value.(string); ok {
			return normalizeNonEmpty(text)
		}
	}
	return ""
}

func saveControlConfig(payload map[string]any) (map[string]any, error) {
	state := map[string]any{}
	if data, err := os.ReadFile(codexStatePath()); err == nil && len(data) > 0 {
		_ = json.Unmarshal(data, &state)
	}
	if state == nil {
		state = map[string]any{}
	}
	config := normalizeControlConfigPayload(payload)
	state["controlConfig"] = config
	if _, ok := state["pinnedThreadIds"]; !ok {
		state["pinnedThreadIds"] = []string{}
	}
	if _, ok := state["archivedThreadIds"]; !ok {
		state["archivedThreadIds"] = []string{}
	}
	if _, ok := state["titleOverrides"]; !ok {
		state["titleOverrides"] = map[string]any{}
	}
	if _, ok := state["guiFailureReports"]; !ok {
		state["guiFailureReports"] = map[string]any{}
	}

	statePath := codexStatePath()
	if err := os.MkdirAll(filepath.Dir(statePath), 0755); err != nil {
		return nil, err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return nil, err
	}
	data = append(data, '\n')
	if err := os.WriteFile(statePath, data, 0600); err != nil {
		return nil, err
	}
	return config, nil
}

func normalizeControlConfigPayload(input map[string]any) map[string]any {
	if input == nil {
		input = map[string]any{}
	}
	port := parseSavedPort(input["port"])
	var portValue any = ""
	if port > 0 {
		portValue = port
	}
	relayURL := stringFromAny(input["relayUrl"])
	if len([]rune(relayURL)) > 240 {
		relayURL = string([]rune(relayURL)[:240])
	}
	return map[string]any{
		"port":          portValue,
		"relayUrl":      relayURL,
		"deviceId":      defaultRelayDeviceId(),
		"remoteKeyMode": "manual",
		"remoteKey":     normalizeRemoteKey(stringFromAny(input["remoteKey"])),
	}
}

func publicDesktopControlConfig(config map[string]any) map[string]any {
	remoteKey := stringFromAny(config["remoteKey"])
	return map[string]any{
		"port":                config["port"],
		"relayUrl":            stringFromAny(config["relayUrl"]),
		"deviceId":            stringFromAny(config["deviceId"]),
		"remoteKeyMode":       "manual",
		"remoteKey":           remoteKey,
		"remoteKeyConfigured": remoteKey != "",
		"remoteKeyMasked":     redactSecret(remoteKey),
	}
}

func redactSecret(value string) string {
	secret := strings.TrimSpace(value)
	if secret == "" {
		return ""
	}
	runes := []rune(secret)
	if len(runes) <= 4 {
		return "***"
	}
	return string(runes[:2]) + "***" + string(runes[len(runes)-2:])
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func savedControlValue(key string) (any, bool) {
	data, err := os.ReadFile(codexStatePath())
	if err != nil {
		return nil, false
	}

	var state struct {
		ControlConfig map[string]any `json:"controlConfig"`
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, false
	}
	value, ok := state.ControlConfig[key]
	return value, ok
}

func codexStatePath() string {
	if dir := os.Getenv("CODEX_STATE_DIR"); strings.TrimSpace(dir) != "" {
		return filepath.Join(dir, "state.json")
	}
	return filepath.Join(homeDir(), ".codex", "state.json")
}

func homeDir() string {
	if dir, err := os.UserHomeDir(); err == nil && dir != "" {
		return dir
	}
	if dir := os.Getenv("USERPROFILE"); dir != "" {
		return dir
	}
	if dir := os.Getenv("HOME"); dir != "" {
		return dir
	}
	return "."
}

func parseSavedPort(value any) int {
	switch typed := value.(type) {
	case float64:
		return parsePort(fmt.Sprintf("%.0f", typed))
	case string:
		return parsePort(typed)
	default:
		return 0
	}
}

func parsePort(value string) int {
	port, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || port <= 0 || port > 65535 {
		return 0
	}
	return port
}

func normalizeNonEmpty(value string) string {
	return strings.TrimRight(strings.TrimSpace(value), "/")
}

func defaultRelayDeviceId() string {
	username := ""
	if user := strings.TrimSpace(os.Getenv("USERNAME")); user != "" {
		username = user
	} else if user := strings.TrimSpace(os.Getenv("USER")); user != "" {
		username = user
	}
	if username == "" {
		username = strings.TrimSpace(os.Getenv("COMPUTERNAME"))
	}
	if username == "" {
		if hostname, err := os.Hostname(); err == nil {
			username = hostname
		}
	}
	normalized := strings.Map(func(ch rune) rune {
		if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '.' || ch == '_' || ch == '-' {
			return ch
		}
		return '-'
	}, strings.TrimSpace(username))
	normalized = strings.Trim(normalized, "-")
	if len([]rune(normalized)) > 58 {
		normalized = string([]rune(normalized)[:58])
	}
	if normalized == "" {
		return "windows-pc"
	}
	return normalized
}

func normalizeRemoteKey(value string) string {
	var builder strings.Builder
	for _, ch := range strings.TrimSpace(value) {
		if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
			continue
		}
		if builder.Len() >= 80 {
			break
		}
		builder.WriteRune(ch)
	}
	return builder.String()
}

func generateToken() string {
	bytes := make([]byte, 18)
	if _, err := rand.Read(bytes); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(bytes)
}

func findAvailablePort(start int, attempts int) int {
	for port := start; port < start+attempts && port <= 65535; port++ {
		if portAvailable(port) {
			return port
		}
	}
	return 0
}

func portAvailable(port int) bool {
	listener, err := net.Listen("tcp", "127.0.0.1:"+intString(port))
	if err != nil {
		return false
	}
	_ = listener.Close()
	return true
}

func waitForPortRelease(port int, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if portAvailable(port) {
			return
		}
		time.Sleep(120 * time.Millisecond)
	}
}
