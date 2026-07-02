package main

import (
	"net/http"
	"net/http/httptest"
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
