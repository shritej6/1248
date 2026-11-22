SHELL := /bin/bash
PKGS := $(wildcard contracts/package.json packages/*/package.json apps/*/package.json exam/package.json)
ROOT_LINT := tools eslint.config.js

.PHONY: check lint typecheck test docs comments secrets exam android e2e dev seed media

check: lint typecheck test docs comments secrets exam android
	@echo "check: all targets passed"

lint:
	pnpm exec eslint $(ROOT_LINT)
	pnpm exec prettier --check $(ROOT_LINT)
	$(if $(PKGS),pnpm -r run lint,@echo "lint: no packages yet, package lint skipped")

typecheck:
	$(if $(PKGS),pnpm -r run typecheck,@echo "typecheck: no packages yet, skipped")

test:
	node --test tools/test/
	$(if $(PKGS),pnpm -r run test,@echo "test: no packages yet, package tests skipped")

docs:
	node tools/check-docs.mjs

comments:
	node tools/check-comments.mjs

secrets:
	git ls-files -z --cached --others --exclude-standard | xargs -0 pnpm exec secretlint --maskSecrets
	@echo "secrets: no secrets found"

exam:
	node tools/check-exam-record.mjs

android:
	@if [ -x apps/android/gradlew ]; then cd apps/android && ./gradlew --quiet testDebugUnitTest; else echo "android: no android project yet, skipped"; fi

e2e:
	@if [ -f apps/web/playwright.config.ts ]; then pnpm --filter ./apps/web exec playwright install chromium && pnpm --filter ./apps/web run e2e; else echo "e2e: no web app yet, skipped"; fi

.PHONY: dev-offline dev-prep
DEV_FLAGS := --ip 127.0.0.1 --port 8787

dev-prep:
	@if [ -f apps/web/package.json ]; then pnpm --filter ./apps/web run build; else echo "dev: no web app yet, web build skipped"; fi
	@test -f apps/hub/.dev.vars || echo "dev: apps/hub/.dev.vars is missing, copy apps/hub/.dev.vars.example and set the codes"

dev: dev-prep
	@echo "dev: the AI jobs run on Workers AI, so run npx wrangler login once"
	pnpm --filter ./apps/hub exec wrangler dev $(DEV_FLAGS)

dev-offline: dev-prep
	@echo "dev-offline: no network, each AI job goes to a person at once and each new card shows AI did not answer"
	pnpm --filter ./apps/hub exec wrangler dev --local $(DEV_FLAGS)

seed:
	@test -f apps/hub/.dev.vars || { echo "seed: copy apps/hub/.dev.vars.example to apps/hub/.dev.vars and set BOOTSTRAP_CODE"; exit 1; }
	@codes="$$(node --env-file=apps/hub/.dev.vars apps/hub/scripts/seed.ts)" && printf '%s\n' "$$codes" > .demo-codes.txt
	@echo "seed: one join code for each member is in .demo-codes.txt"

media:
	node tools/media/run.mjs
