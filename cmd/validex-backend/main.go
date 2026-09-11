package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"validex/internal/appidentity"
	"validex/internal/canbridge"
)

func main() {
	startedAt := time.Now().UTC()
	if handled, exitCode := appidentity.HandleCommand(
		os.Args[1:], appidentity.Backend, startedAt, os.Stdout, os.Stderr,
	); handled {
		os.Exit(exitCode)
	}
	log.SetOutput(os.Stderr)
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)
	if err := appidentity.WriteReport(os.Stderr, appidentity.Collect(appidentity.Backend, startedAt)); err != nil {
		log.Printf("[validex-backend:identity-error] %v", err)
	}

	ctx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	if err := serve(
		ctx,
		os.Stdin,
		os.Stdout,
		canbridge.NewBridge(),
	); err != nil {
		log.Printf("[validex-backend:error] %v", err)
		os.Exit(1)
	}
}
