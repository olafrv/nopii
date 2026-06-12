# nopii Makefile
#
# `make wipe` removes every git-untracked and gitignored path (downloads,
# node_modules, model weights, datasets, caches, logs, tmp) so you can rebuild
# from a clean slate. It PRESERVES things that are gitignored on purpose and
# painful or impossible to recreate: your real .env, OLAF.md, and the
# container's Claude auth state (data/.claude*). It prints exactly what will be
# deleted and asks for confirmation first. Nothing git-tracked is ever touched.

.DEFAULT_GOAL := help
.PHONY: help wipe

# Paths git clean must NOT remove (gitignore-style, anchored to repo root).
WIPE_KEEP := -e /.env -e /OLAF.md -e /data/.claude -e /data/.claude.json

help:
	@echo "Targets:"
	@echo "  wipe   Delete ALL git-untracked & gitignored files to rebuild from"
	@echo "         scratch (node_modules, model weights, datasets, caches, logs,"
	@echo "         tmp). PRESERVES .env, OLAF.md and container auth"
	@echo "         (data/.claude*). Prompts for confirmation after listing the"
	@echo "         exact paths. Never touches git-tracked files."
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
	echo "PRESERVED: .env, OLAF.md, data/.claude*, and all git-tracked files."; \
	printf "Type 'y' to proceed, anything else to abort: "; \
	read ans; \
	if [ "$$ans" != "y" ] && [ "$$ans" != "Y" ]; then \
		echo "Aborted — nothing deleted."; \
		exit 0; \
	fi; \
	git clean -fdx $(WIPE_KEEP); \
	echo "Done — wiped."
