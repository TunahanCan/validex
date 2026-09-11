// Package appidentity reports stable product identity and verifiable information
// about the currently running binary. It collects no host or request data.
package appidentity

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"time"
)

// Version and Revision can be set by the build with -ldflags -X. Unstamped
// builds fall back to Go build information, never to a fabricated release.
var (
	Version  = "development"
	Revision = "unknown"
)

//go:embed manifest.json
var manifestJSON []byte

type Component string

const (
	Backend Component = "backend"
	CLI     Component = "cli"

	// Bound startup hashing work and memory even if a damaged installation
	// replaces the executable path with an unexpectedly large file.
	maximumExecutableBytes = 512 << 20
	hashBufferBytes        = 32 << 10
)

type Manifest struct {
	SchemaVersion      int    `json:"schemaVersion"`
	ProductUUID        string `json:"productUUID"`
	ApplicationID      string `json:"applicationID"`
	ApplicationName    string `json:"applicationName"`
	BackendProcessName string `json:"backendProcessName"`
	CLIProcessName     string `json:"cliProcessName"`
}

type DiagnosticError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

type Report struct {
	Manifest
	Event            string            `json:"event"`
	Component        Component         `json:"component"`
	ComponentID      string            `json:"componentID"`
	ProcessName      string            `json:"processName"`
	Version          string            `json:"version"`
	Revision         string            `json:"revision"`
	RevisionModified *bool             `json:"revisionModified,omitempty"`
	OS               string            `json:"os"`
	Arch             string            `json:"arch"`
	ExecutablePath   string            `json:"executablePath"`
	ExecutableName   string            `json:"executableName,omitempty"`
	ExecutableSHA256 string            `json:"executableSHA256"`
	PID              int               `json:"pid"`
	PPID             int               `json:"ppid"`
	StartedAt        string            `json:"startedAt"`
	GoVersion        string            `json:"goVersion"`
	DiagnosticErrors []DiagnosticError `json:"diagnosticErrors,omitempty"`
}

// ReadManifest returns the canonical identity embedded in this binary.
func ReadManifest() (Manifest, error) {
	var manifest Manifest
	if err := json.Unmarshal(manifestJSON, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("read embedded application identity: %w", err)
	}
	return manifest, nil
}

type buildMetadata struct {
	version  string
	revision string
	modified *bool
}

func metadata(version, revision string, build *debug.BuildInfo) buildMetadata {
	result := buildMetadata{
		version:  strings.TrimSpace(version),
		revision: strings.TrimSpace(revision),
	}
	if result.version == "" {
		result.version = "development"
	}
	if result.revision == "" {
		result.revision = "unknown"
	}
	if build == nil {
		return result
	}
	if result.version == "development" && build.Main.Version != "" &&
		build.Main.Version != "(devel)" {
		result.version = build.Main.Version
	}
	for _, setting := range build.Settings {
		switch setting.Key {
		case "vcs.revision":
			if result.revision == "unknown" && setting.Value != "" {
				result.revision = setting.Value
			}
		case "vcs.modified":
			if setting.Value == "true" || setting.Value == "false" {
				modified := setting.Value == "true"
				result.modified = &modified
			}
		}
	}
	return result
}

func currentMetadata() buildMetadata {
	build, _ := debug.ReadBuildInfo()
	return metadata(Version, Revision, build)
}

// Collect creates a report without failing startup when executable metadata is
// unavailable. Diagnostic failures remain explicit fields in the report.
func Collect(component Component, startedAt time.Time) Report {
	return collect(component, startedAt, os.Executable)
}

func collect(
	component Component,
	startedAt time.Time,
	executable func() (string, error),
) Report {
	manifest, manifestErr := ReadManifest()
	build := currentMetadata()
	report := Report{
		Manifest:         manifest,
		Event:            "validex.identity",
		Component:        component,
		Version:          build.version,
		Revision:         build.revision,
		OS:               runtime.GOOS,
		Arch:             runtime.GOARCH,
		PID:              os.Getpid(),
		PPID:             os.Getppid(),
		StartedAt:        startedAt.UTC().Format(time.RFC3339Nano),
		GoVersion:        runtime.Version(),
		RevisionModified: build.modified,
	}
	if manifestErr != nil {
		report.addError("manifest", manifestErr)
	}
	switch component {
	case Backend:
		report.ComponentID = manifest.ApplicationID
		report.ProcessName = manifest.BackendProcessName
	case CLI:
		report.ComponentID = manifest.ApplicationID
		report.ProcessName = manifest.CLIProcessName
	default:
		report.addError("component", fmt.Errorf("unrecognized application component %q", component))
	}
	if runtime.GOOS == "windows" && report.ProcessName != "" {
		report.ProcessName += ".exe"
	}
	path, err := executable()
	if err != nil {
		report.addError("executablePath", err)
		return report
	}
	report.ExecutablePath, err = filepath.Abs(path)
	if err != nil {
		report.addError("executablePath", err)
		return report
	}
	resolved, err := filepath.EvalSymlinks(report.ExecutablePath)
	if err != nil {
		report.addError("executablePath", fmt.Errorf("resolve executable symlinks: %w", err))
	} else {
		report.ExecutablePath = resolved
	}
	report.ExecutableName = filepath.Base(report.ExecutablePath)
	report.ExecutableSHA256, err = executableSHA256(report.ExecutablePath)
	if err != nil {
		report.addError("executableSHA256", err)
	}
	return report
}

func (report *Report) addError(field string, err error) {
	report.DiagnosticErrors = append(report.DiagnosticErrors, DiagnosticError{
		Field: field, Message: err.Error(),
	})
}

func executableSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open executable for SHA-256: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", fmt.Errorf("inspect executable for SHA-256: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("executable is not a regular file")
	}
	if info.Size() > maximumExecutableBytes {
		return "", fmt.Errorf("executable exceeds the %d-byte SHA-256 limit", maximumExecutableBytes)
	}
	return executableDigest(file, maximumExecutableBytes)
}

func executableDigest(input io.Reader, maximumBytes int64) (string, error) {
	hash := sha256.New()
	read, err := io.CopyBuffer(
		hash,
		io.LimitReader(input, maximumBytes+1),
		make([]byte, hashBufferBytes),
	)
	if err != nil {
		return "", fmt.Errorf("read executable for SHA-256: %w", err)
	}
	if read > maximumBytes {
		return "", fmt.Errorf("executable exceeds the %d-byte SHA-256 limit", maximumBytes)
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

// WriteReport writes one JSON line. Backend callers use stderr to keep framed
// stdout IPC untouched; explicit --identity commands use stdout.
func WriteReport(output io.Writer, report Report) error {
	return json.NewEncoder(output).Encode(report)
}

// HandleCommand recognizes only leading standalone diagnostic flags, so a CLI
// subcommand's arguments and normal machine-readable output remain unchanged.
func HandleCommand(
	args []string,
	component Component,
	startedAt time.Time,
	stdout, stderr io.Writer,
) (handled bool, exitCode int) {
	if len(args) == 0 || (args[0] != "--identity" && args[0] != "--version") {
		return false, 0
	}
	if len(args) != 1 {
		_, _ = fmt.Fprintln(stderr, "Validex: --identity and --version must be used alone.")
		return true, 2
	}
	var err error
	if args[0] == "--identity" {
		err = WriteReport(stdout, Collect(component, startedAt))
	} else {
		build := currentMetadata()
		_, err = fmt.Fprintf(stdout, "Validex %s %s (revision %s)\n", component, build.version, build.revision)
	}
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "Validex: write application identity: %v\n", err)
		return true, 1
	}
	return true, 0
}
