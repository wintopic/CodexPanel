package main

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

func desktopAssetMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && (r.URL.Path == "/" || r.URL.Path == "" || r.URL.Path == "/index.html") {
			clone := r.Clone(r.Context())
			clone.URL.Path = "/control.html"
			clone.URL.RawPath = ""
			next.ServeHTTP(w, clone)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type assetFallbackHandler struct {
	app *App
}

func (handler assetFallbackHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/codex/") {
		handler.app.proxyToSidecar(w, r)
		return
	}
	http.NotFound(w, r)
}

func (a *App) proxyToSidecar(w http.ResponseWriter, r *http.Request) {
	port := a.currentPort()
	if port <= 0 {
		http.Error(w, "CodexPanel local service is not running.", http.StatusServiceUnavailable)
		return
	}

	target, err := url.Parse("http://127.0.0.1:" + intString(port))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = target.Host
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.URL.Path = r.URL.Path
		req.URL.RawPath = r.URL.RawPath
		req.URL.RawQuery = r.URL.RawQuery
	}
	proxy.ErrorHandler = func(rw http.ResponseWriter, _ *http.Request, proxyErr error) {
		http.Error(rw, proxyErr.Error(), http.StatusBadGateway)
	}
	proxy.ServeHTTP(w, r)
}
