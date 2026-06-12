# nopii Makefile
#
# `make wipe` removes every git-untracked and gitignored path (downloads,
# node_modules, model weights, datasets, caches, logs, tmp) AND the container's
# generated Claude state (data/.claude*, re-created on next login) so you can
# rebuild from a clean slate. It PRESERVES only your real .env (secrets/config)
# and OLAF.md (never tracked, never deleted). It prints exactly what will be
# deleted and asks for confirmation first. Nothing git-tracked is ever touched
# (so data/.claude/.gitkeep, which is tracked, survives).

.DEFAULT_GOAL := help
.PHONY: help wipe

# Paths git clean must NOT remove (gitignore-style, anchored to repo root).
WIPE_KEEP := -e /.env -e /OLAF.md

help:
	@echo "Targets:"
	@echo "  wipe   Delete ALL git-untracked & gitignored files to rebuild from"
	@echo "         scratch (node_modules, model weights, datasets, caches, logs,"
	@echo "         tmp) plus container Claude state (data/.claude*). PRESERVES"
	@echo "         only .env and OLAF.md. Prompts for confirmation after listing"
	@echo "         the exact paths. Never touches git-tracked files."
	@echo "  help   Show this help (default)."

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
