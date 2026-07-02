package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
)

var logMu sync.Mutex

func logLine(values ...any) {
	line := fmt.Sprintln(values...)
	fmt.Print(line)

	logPath := os.Getenv("CODEXPANEL_LOG_FILE")
	if logPath == "" {
		return
	}

	logMu.Lock()
	defer logMu.Unlock()
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return
	}
	file, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = file.WriteString(line)
}

func processOutput() io.Writer {
	logPath := os.Getenv("CODEXPANEL_LOG_FILE")
	if logPath == "" {
		return io.Discard
	}
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return io.Discard
	}
	file, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return io.Discard
	}
	return file
}
