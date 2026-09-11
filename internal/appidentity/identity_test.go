package appidentity

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"testing"
	"time"
)

func TestManifestPreservesOneCanonicalApplicationIdentity(t *testing.T) {
	manifest, err := ReadManifest()
	if err != nil {
		t.Fatal(err)
	}
	want := Manifest{
		SchemaVersion:      1,
		ProductUUID:        "6a2bf295-cc04-4390-abaf-9ccfcdbc3379",
		ApplicationID:      "com.validex.Validex",
		ApplicationName:    "Validex",
		BackendProcessName: "validex-backend",
		CLIProcessName:     "validex-cli",
	}
	if manifest != want {
		t.Fatalf("canonical identity changed: got %+v, want %+v", manifest, want)
	}
}

func TestMetadataUsesTruthfulBuildFallbacksAndLinkerOverrides(t *testing.T) {
	build := &debug.BuildInfo{
		Main: debug.Module{Version: "v0.3.0"},
		Settings: []debug.BuildSetting{
			{Key: "vcs.revision", Value: "source-revision"},
			{Key: "vcs.modified", Value: "true"},
		},
	}
	for _, scenario := range []struct {
		name, version, revision, wantVersion, wantRevision string
		info                                               *debug.BuildInfo
	}{
		{"unstamped", "", "", "development", "unknown", nil},
		{"build info", "development", "unknown", "v0.3.0", "source-revision", build},
		{"linker overrides", "0.4.0", "release-revision", "0.4.0", "release-revision", build},
		{"development info", "", "", "development", "unknown", &debug.BuildInfo{Main: debug.Module{Version: "(devel)"}}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			result := metadata(scenario.version, scenario.revision, scenario.info)
			if result.version != scenario.wantVersion || result.revision != scenario.wantRevision {
				t.Fatalf("metadata = %+v, want %s / %s", result, scenario.wantVersion, scenario.wantRevision)
			}
			if scenario.info == build && (result.modified == nil || !*result.modified) {
				t.Fatal("dirty source state was omitted")
			}
		})
	}
}

func TestCollectReportsCurrentExecutableHashAndProcessFacts(t *testing.T) {
	started := time.Date(2026, time.September, 11, 12, 34, 56, 123, time.FixedZone("UTC+3", 3*60*60))
	report := Collect(Backend, started)
	if len(report.DiagnosticErrors) != 0 {
		t.Fatalf("identity diagnostics: %+v", report.DiagnosticErrors)
	}
	if report.Event != "validex.identity" || report.ComponentID != "com.validex.Validex" {
		t.Fatalf("wrong component identity: %+v", report)
	}
	if report.PID != os.Getpid() || report.PPID != os.Getppid() ||
		report.OS != runtime.GOOS || report.Arch != runtime.GOARCH || report.GoVersion != runtime.Version() {
		t.Fatalf("runtime facts do not describe this process: %+v", report)
	}
	if report.StartedAt != "2026-09-11T09:34:56.000000123Z" {
		t.Fatalf("start timestamp is not normalized UTC: %s", report.StartedAt)
	}
	if !filepath.IsAbs(report.ExecutablePath) || report.ExecutableName != filepath.Base(report.ExecutablePath) {
		t.Fatalf("executable path is not absolute and consistent: %+v", report)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := filepath.EvalSymlinks(executable)
	if err != nil {
		t.Fatal(err)
	}
	if report.ExecutablePath != resolved {
		t.Fatalf("executable path = %q, want actual binary %q", report.ExecutablePath, resolved)
	}
	file, err := os.Open(resolved)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		t.Fatal(err)
	}
	if report.ExecutableSHA256 != hex.EncodeToString(hash.Sum(nil)) {
		t.Fatal("reported SHA-256 does not match the actual running binary")
	}
}

func TestCollectResolvesSymlinkBeforeHashing(t *testing.T) {
	dir := t.TempDir()
	binary := filepath.Join(dir, "real-backend")
	contents := []byte("test executable content\n")
	if err := os.WriteFile(binary, contents, 0o700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "validex-backend")
	if err := os.Symlink(binary, link); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("Windows symlink permission unavailable: %v", err)
		}
		t.Fatal(err)
	}
	report := collect(Backend, time.Now(), func() (string, error) { return link, nil })
	resolved, err := filepath.EvalSymlinks(binary)
	if err != nil {
		t.Fatal(err)
	}
	wantHash := sha256.Sum256(contents)
	if report.ExecutablePath != resolved || report.ExecutableSHA256 != hex.EncodeToString(wantHash[:]) {
		t.Fatalf("symlink did not resolve to hashed executable: %+v", report)
	}
}

func TestCollectKeepsIdentityWhenExecutableMetadataIsUnavailable(t *testing.T) {
	for _, scenario := range []struct {
		name       string
		executable func() (string, error)
		wantField  string
	}{
		{"lookup error", func() (string, error) { return "", errors.New("executable lookup unavailable") }, "executablePath"},
		{"missing binary", func() (string, error) { return filepath.Join(t.TempDir(), "missing"), nil }, "executableSHA256"},
		{"directory", func() (string, error) { return t.TempDir(), nil }, "executableSHA256"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			report := collect(CLI, time.Now(), scenario.executable)
			if report.ProductUUID == "" || report.ComponentID != "com.validex.Validex" || report.ExecutableSHA256 != "" {
				t.Fatalf("metadata error corrupted stable identity or invented a hash: %+v", report)
			}
			for _, diagnostic := range report.DiagnosticErrors {
				if diagnostic.Field == scenario.wantField && diagnostic.Message != "" {
					return
				}
			}
			t.Fatalf("missing explicit %s diagnostic: %+v", scenario.wantField, report)
		})
	}
}

func TestExecutableDigestBoundsStreamingMemoryAndRejectsOversizedInput(t *testing.T) {
	contents := strings.Repeat("binary-content", 10_000)
	input := &recordingReader{input: strings.NewReader(contents)}
	digest, err := executableDigest(input, int64(len(contents)))
	if err != nil {
		t.Fatal(err)
	}
	want := sha256.Sum256([]byte(contents))
	if digest != hex.EncodeToString(want[:]) || input.largestRead > hashBufferBytes {
		t.Fatalf("streamed digest = %s, largest read = %d", digest, input.largestRead)
	}
	if digest, err := executableDigest(strings.NewReader("ninebytes"), 8); err == nil || digest != "" {
		t.Fatalf("oversized input produced a usable digest: %q, %v", digest, err)
	}
	if digest, err := executableDigest(failingReader{}, 8); err == nil || digest != "" {
		t.Fatalf("failed read produced a usable digest: %q, %v", digest, err)
	}
}

type recordingReader struct {
	input       io.Reader
	largestRead int
}

func (reader *recordingReader) Read(buffer []byte) (int, error) {
	reader.largestRead = max(reader.largestRead, len(buffer))
	return reader.input.Read(buffer)
}

type failingReader struct{}

func (failingReader) Read([]byte) (int, error) {
	return 0, errors.New("binary read failed")
}

func TestCommandFlagsPreserveNormalCLIArguments(t *testing.T) {
	for _, args := range [][]string{nil, {"help"}, {"run", "--identity"}, {"--help"}, {"--identity=true"}} {
		var stdout, stderr bytes.Buffer
		handled, code := HandleCommand(args, CLI, time.Now(), &stdout, &stderr)
		if handled || code != 0 || stdout.Len() != 0 || stderr.Len() != 0 {
			t.Fatalf("diagnostics intercepted existing arguments %q", args)
		}
	}
	var stdout, stderr bytes.Buffer
	handled, code := HandleCommand([]string{"--identity", "unexpected"}, CLI, time.Now(), &stdout, &stderr)
	if !handled || code != 2 || stdout.Len() != 0 || !strings.Contains(stderr.String(), "used alone") {
		t.Fatalf("invalid diagnostics arguments = handled %t, code %d, stdout %q, stderr %q", handled, code, stdout.String(), stderr.String())
	}
}

func TestIdentityCommandWritesOnlyOneJSONReport(t *testing.T) {
	t.Setenv("VALIDEX_IDENTITY_TEST_SECRET", "must-never-appear-in-report")
	var stdout, stderr bytes.Buffer
	handled, code := HandleCommand([]string{"--identity"}, CLI, time.Now(), &stdout, &stderr)
	if !handled || code != 0 || stderr.Len() != 0 || strings.Count(stdout.String(), "\n") != 1 {
		t.Fatalf("identity output = handled %t, code %d, stdout %q, stderr %q", handled, code, stdout.String(), stderr.String())
	}
	var report Report
	if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if report.Component != CLI || report.ExecutableSHA256 == "" {
		t.Fatalf("incomplete CLI identity report: %+v", report)
	}
	if strings.Contains(stdout.String(), "must-never-appear-in-report") {
		t.Fatal("identity report included environment data")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(stdout.Bytes(), &fields); err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"args", "environment", "hostname", "machineID", "user", "publisher"} {
		if _, exists := fields[forbidden]; exists {
			t.Fatalf("identity report contains unrequested or unverifiable field %q", forbidden)
		}
	}
}

func TestCommandVersionAndWriteFailure(t *testing.T) {
	var stdout, stderr bytes.Buffer
	handled, code := HandleCommand([]string{"--version"}, Backend, time.Now(), &stdout, &stderr)
	if !handled || code != 0 || stderr.Len() != 0 || !strings.HasPrefix(stdout.String(), "Validex backend ") {
		t.Fatalf("version output = handled %t, code %d, stdout %q, stderr %q", handled, code, stdout.String(), stderr.String())
	}
	handled, code = HandleCommand([]string{"--version"}, Backend, time.Now(), failingWriter{}, &stderr)
	if !handled || code != 1 || !strings.Contains(stderr.String(), "output unavailable") {
		t.Fatalf("identity output failure was not reported: code %d, stderr %q", code, stderr.String())
	}
}

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) {
	return 0, fmt.Errorf("output unavailable")
}
