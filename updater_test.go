package main

import "testing"

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		left  string
		right string
		want  int
	}{
		{left: "3.0.6", right: "3.0.5", want: 1},
		{left: "v3.0.5", right: "3.0.5", want: 0},
		{left: "3.1.0", right: "3.0.99", want: 1},
		{left: "3.0.4", right: "3.0.5", want: -1},
	}
	for _, item := range cases {
		got := compareVersions(item.left, item.right)
		if got != item.want {
			t.Fatalf("compareVersions(%q, %q) = %d, want %d", item.left, item.right, got, item.want)
		}
	}
}

func TestVersionFromReleaseTag(t *testing.T) {
	if got := versionFromReleaseTag("v3.0.5"); got != "3.0.5" {
		t.Fatalf("versionFromReleaseTag returned %q", got)
	}
	if got := versionFromReleaseTag("latest"); got != "0.0.0" {
		t.Fatalf("latest tag returned %q", got)
	}
}

func TestVersionFromLatestReleaseAsset(t *testing.T) {
	release := &githubRelease{
		TagName: "latest",
		Assets: []githubAsset{
			{Name: "CodexPanel-Linux.tar.gz"},
			{Name: "CodexPanel-Setup-3.0.6.exe"},
		},
	}
	if got := versionFromRelease(release); got != "3.0.6" {
		t.Fatalf("versionFromRelease returned %q", got)
	}
}
