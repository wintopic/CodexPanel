//go:build windows

package main

import (
	"net/http"
	"net/url"
	"strings"

	"golang.org/x/sys/windows/registry"
)

func systemProxy(req *http.Request) (*url.URL, error) {
	if proxy, err := http.ProxyFromEnvironment(req); err != nil || proxy != nil {
		return proxy, err
	}
	server := windowsProxyServer()
	if server == "" {
		return nil, nil
	}
	return url.Parse(proxyServerForScheme(server, req.URL.Scheme))
}

func windowsProxyServer() string {
	key, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Internet Settings`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer key.Close()
	enabled, _, err := key.GetIntegerValue("ProxyEnable")
	if err != nil || enabled == 0 {
		return ""
	}
	server, _, err := key.GetStringValue("ProxyServer")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(server)
}

func proxyServerForScheme(server string, scheme string) string {
	server = strings.TrimSpace(server)
	if server == "" {
		return ""
	}
	if !strings.Contains(server, "=") {
		return ensureProxyScheme(server)
	}
	values := map[string]string{}
	for _, part := range strings.Split(server, ";") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		values[strings.ToLower(strings.TrimSpace(key))] = strings.TrimSpace(value)
	}
	if value := values[strings.ToLower(scheme)]; value != "" {
		return ensureProxyScheme(value)
	}
	if value := values["http"]; value != "" {
		return ensureProxyScheme(value)
	}
	if value := values["https"]; value != "" {
		return ensureProxyScheme(value)
	}
	return ""
}

func ensureProxyScheme(server string) string {
	if strings.Contains(server, "://") {
		return server
	}
	return "http://" + server
}
