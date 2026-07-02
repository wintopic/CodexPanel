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

func main() {
	publicFS, err := fs.Sub(embeddedPublic, "public")
	if err != nil {
		panic(fmt.Errorf("load public assets: %w", err))
	}

	app := NewApp()

	err = wails.Run(&options.App{
		Title:         "CodexPanel 控制面板",
		Width:         760,
		Height:        392,
		MinWidth:      760,
		MinHeight:     392,
		MaxWidth:      760,
		MaxHeight:     392,
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
