# nopii Makefile
#
# `make wipe` removes every git-untracked and gitignored path (downloads,
# node_modules, model weights, datasets, caches, logs, tmp) AND the container's
# generated Claude state (data/.claude*, re-created on next login) so you can
# rebuild from a clean slate. It PRESERVES your real .env (secrets/config) and
# OLAF.md (both gitignored on purpose); everything git-tracked is untouched too
# (so committed files like .vscode/settings.json and data/.claude/.gitkeep
# survive). It prints exactly what will be deleted and asks for confirmation
# first.

.DEFAULT_GOAL := help
.PHONY: help wipe scan scan-staged

# Untracked/ignored paths git clean must NOT remove (gitignore-style, anchored
# to repo root). Tracked files are already safe — git clean never touches them.
WIPE_KEEP := -e /.env -e /OLAF.md

help:
	@echo "Targets:"
	@echo "  scan         Scan the FULL git history for secrets with gitleaks"
	@echo "               (honours .gitleaks.toml). Exits non-zero on a finding."
	@echo "  scan-staged  Scan only staged changes (fast; what a pre-commit hook"
	@echo "               runs). Blocks a commit that would introduce a secret."
	@echo "  wipe         Delete ALL git-untracked & gitignored files to rebuild"
	@echo "               from scratch (node_modules, model weights, datasets,"
	@echo "               caches, logs, tmp) plus container Claude state"
	@echo "               (data/.claude*). PRESERVES .env and OLAF.md (and"
	@echo "               everything git-tracked). Confirms before deleting."
	@echo "  help         Show this help (default)."

wipe:
	@files=$$(git clean -ndx $(WIPE_KEEP)); \
	if [ -z "$$files" ]; then \
		echo "Nothing to wipe — no untracked or ignored files to remove."; \
		exit 0; \
	fi; \
	echo "WARNING: these untracked/ignored paths will be PERMANENTLY DELETED:"; \
	echo "$$files" | sed 's/^Would remove /  - /'; \
	echo; \
	echo "PRESERVED: .env, OLAF.md, and all git-tracked files."; \
	printf "Type 'y' to proceed, anything else to abort: "; \
	read ans; \
	if [ "$$ans" != "y" ] && [ "$$ans" != "Y" ]; then \
		echo "Aborted — nothing deleted."; \
		exit 0; \
	fi; \
	git clean -fdx $(WIPE_KEEP); \
	echo "Done — wiped."

# Secret scanning (gitleaks). Both targets honour .gitleaks.toml (which keeps
# all default rules and allowlists only the public OAuth client_id).
scan:
	@command -v gitleaks >/dev/null 2>&1 || { \
		echo "gitleaks not found — install it: brew install gitleaks"; \
		exit 127; \
	}
	gitleaks detect --source . --log-opts="--all" --redact -v

scan-staged:
	@command -v gitleaks >/dev/null 2>&1 || { \
		echo "gitleaks not found — install it: brew install gitleaks"; \
		exit 127; \
	}
	gitleaks protect --staged --redact -v
