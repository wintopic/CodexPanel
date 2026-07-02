//go:build !windows

package main

import (
	"net/http"
	"net/url"
)

func systemProxy(req *http.Request) (*url.URL, error) {
	return http.ProxyFromEnvironment(req)
}
