package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"testing"

	"validex/internal/appidentity"
)

func TestIdentityCommandExitsBeforeBackendProtocolStartup(t *testing.T) {
	command := exec.Command(os.Args[0], "-test.run=^TestIdentityBackendHelperProcess$")
	command.Env = append(os.Environ(), "VALIDEX_IDENTITY_BACKEND_HELPER=1")
	var stdout, stderr bytes.Buffer
	command.Stdout, command.Stderr = &stdout, &stderr
	if err := command.Run(); err != nil {
		t.Fatalf("backend --identity: %v; stderr: %s", err, stderr.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("explicit identity triggered backend startup logging: %s", stderr.String())
	}
	var report appidentity.Report
	if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
		t.Fatalf("identity stdout was not a standalone JSON report: %v; stdout: %q", err, stdout.String())
	}
	if report.Component != appidentity.Backend || report.ExecutableSHA256 == "" {
		t.Fatalf("incomplete backend identity: %+v", report)
	}
}

func TestIdentityBackendHelperProcess(t *testing.T) {
	if os.Getenv("VALIDEX_IDENTITY_BACKEND_HELPER") != "1" {
		return
	}
	os.Args = []string{os.Args[0], "--identity"}
	main()
}
