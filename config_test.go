package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSaveControlConfigWritesState(t *testing.T) {
	t.Setenv("CODEX_STATE_DIR", t.TempDir())
	t.Setenv("USERNAME", "AIGCFREE")

	config, err := saveControlConfig(map[string]any{
		"port":      "8787",
		"relayUrl":  "https://codexpanel-wan.pages.dev",
		"remoteKey": "BFRPWRY",
	})
	if err != nil {
		t.Fatal(err)
	}
	if config["relayUrl"] != "https://codexpanel-wan.pages.dev" {
		t.Fatalf("unexpected relayUrl: %v", config["relayUrl"])
	}
	if config["remoteKey"] != "BFRPWRY" {
		t.Fatalf("unexpected remoteKey: %v", config["remoteKey"])
	}

	data, err := os.ReadFile(filepath.Join(os.Getenv("CODEX_STATE_DIR"), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	var state struct {
		ControlConfig map[string]any `json:"controlConfig"`
	}
	if err := json.Unmarshal(data, &state); err != nil {
		t.Fatal(err)
	}
	if state.ControlConfig["relayUrl"] != "https://codexpanel-wan.pages.dev" {
		t.Fatalf("state relayUrl was not saved: %v", state.ControlConfig["relayUrl"])
	}
	if state.ControlConfig["remoteKey"] != "BFRPWRY" {
		t.Fatalf("state remoteKey was not saved: %v", state.ControlConfig["remoteKey"])
	}
}
