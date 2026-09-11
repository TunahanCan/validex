package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"validex/internal/appidentity"
	"validex/internal/cli"
)

func main() {
	if handled, exitCode := appidentity.HandleCommand(
		os.Args[1:], appidentity.CLI, time.Now().UTC(), os.Stdout, os.Stderr,
	); handled {
		os.Exit(exitCode)
	}
	ctx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	go func() {
		<-ctx.Done()
		stop()
	}()
	exitCode := cli.Execute(ctx, os.Args[1:], os.Stdout, os.Stderr)
	stop()
	os.Exit(exitCode)
}
