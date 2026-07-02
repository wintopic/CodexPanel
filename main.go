package main

import (
	"embed"
	"fmt"
	"io/fs"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:public
var embeddedPublic embed.FS

const (
	desktopWindowWidth  = 760
	desktopWindowHeight = 440
)

func main() {
	publicFS, err := fs.Sub(embeddedPublic, "public")
	if err != nil {
		panic(fmt.Errorf("load public assets: %w", err))
	}

	app := NewApp()

	err = wails.Run(&options.App{
		Title:         "CodexPanel 控制面板",
		Width:         desktopWindowWidth,
		Height:        desktopWindowHeight,
		MinWidth:      desktopWindowWidth,
		MinHeight:     desktopWindowHeight,
		MaxWidth:      desktopWindowWidth,
		MaxHeight:     desktopWindowHeight,
		DisableResize: true,
		AssetServer: &assetserver.Options{
			Assets:     publicFS,
			Handler:    assetFallbackHandler{app: app},
			Middleware: desktopAssetMiddleware,
		},
		BackgroundColour: options.NewRGBA(238, 243, 251, 255),
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
