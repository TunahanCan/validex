package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"testing"

	"validex/internal/appidentity"
)

func TestIdentityCLICommandAndOrdinaryHelpOutput(t *testing.T) {
	for _, argument := range []string{"--identity", "--help"} {
		t.Run(argument, func(t *testing.T) {
			command := exec.Command(os.Args[0], "-test.run=^TestIdentityCLIHelperProcess$")
			command.Env = append(os.Environ(), "VALIDEX_IDENTITY_CLI_HELPER="+argument)
			var stdout, stderr bytes.Buffer
			command.Stdout, command.Stderr = &stdout, &stderr
			if err := command.Run(); err != nil {
				t.Fatalf("CLI %s: %v; stderr: %s", argument, err, stderr.String())
			}
			if stderr.Len() != 0 {
				t.Fatalf("CLI %s unexpectedly logged startup data: %s", argument, stderr.String())
			}
			if argument == "--help" {
				if !strings.Contains(stdout.String(), "validex-cli") || strings.Contains(stdout.String(), "validex.identity") {
					t.Fatalf("ordinary help output changed: %s", stdout.String())
				}
				return
			}
			var report appidentity.Report
			if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
				t.Fatal(err)
			}
			if report.Component != appidentity.CLI || report.ExecutableSHA256 == "" {
				t.Fatalf("incomplete CLI identity: %+v", report)
			}
		})
	}
}

func TestIdentityCLIHelperProcess(t *testing.T) {
	argument := os.Getenv("VALIDEX_IDENTITY_CLI_HELPER")
	if argument == "" {
		return
	}
	os.Args = []string{os.Args[0], argument}
	main()
}
