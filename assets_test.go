package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
)

func TestDesktopAssetMiddlewareRewritesRootToControlPanel(t *testing.T) {
	tests := []string{"/", "", "/index.html"}

	for _, path := range tests {
		t.Run(path, func(t *testing.T) {
			var gotPath string
			next := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
			})

			request := httptest.NewRequest(http.MethodGet, "http://wails.localhost"+path, nil)
			desktopAssetMiddleware(next).ServeHTTP(httptest.NewRecorder(), request)

			if gotPath != "/control.html" {
				t.Fatalf("expected /control.html, got %q", gotPath)
			}
		})
	}
}

func TestDesktopAssetMiddlewareKeepsNonRootAssets(t *testing.T) {
	var gotPath string
	next := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
	})

	request := httptest.NewRequest(http.MethodGet, "http://wails.localhost/icons/icon.png", nil)
	desktopAssetMiddleware(next).ServeHTTP(httptest.NewRecorder(), request)

	if gotPath != "/icons/icon.png" {
		t.Fatalf("expected /icons/icon.png, got %q", gotPath)
	}
}

func TestProxyToSidecarInjectsControlToken(t *testing.T) {
	const controlToken = "desktop-control-token"
	var gotToken string
	sidecar := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotToken = r.Header.Get("x-codex-token")
		w.WriteHeader(http.StatusOK)
	}))
	defer sidecar.Close()

	sidecarURL, err := url.Parse(sidecar.URL)
	if err != nil {
		t.Fatal(err)
	}
	_, portText, err := net.SplitHostPort(sidecarURL.Host)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatal(err)
	}

	app := &App{port: port, token: controlToken}
	request := httptest.NewRequest(http.MethodGet, "http://wails.localhost/codex/control-config", nil)
	recorder := httptest.NewRecorder()
	app.proxyToSidecar(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", recorder.Code)
	}
	if gotToken != controlToken {
		t.Fatalf("expected injected token %q, got %q", controlToken, gotToken)
	}
}
