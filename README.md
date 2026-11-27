# GitHub Review: Skip Tests

A userscript that gets test files and generated files out of your way while reviewing on GitHub.

- **Pull request files/changes pages**: automatically marks test files and generated files as **Viewed** as they render.
- **Pull request file tree**: hover a folder and click **View all** to mark every file in it as Viewed.
- **Commit pages** (`/commit/<sha>` and `/pull/<n>/commits/<sha>`): automatically **collapses** test files and generated files.
- **Commit file tree**: hover a folder and click **Collapse all** to collapse every file in it.

## Install

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open **[github-review-skip-tests.user.js](https://github.com/hyoban/github-review-skip-tests/raw/main/github-review-skip-tests.user.js)** and confirm the install.

Updates are picked up automatically from this repository.

## What counts as a test file

Paths that match any of:

- a `__tests__/`, `__mocks__/`, `test/`, `tests/`, `e2e/`, `fixture/` or `fixtures/` directory
- `*.test.*` / `*.spec.*` JavaScript or TypeScript files
- `test_*.py`, `*_test.py`, `*_test.go`, `conftest.py`

**Generated files** are whatever GitHub itself flags as generated (for example lockfiles, or paths marked `linguist-generated` in `.gitattributes`). They are detected from GitHub's "generated files are not rendered by default" notice.

## Behavior

- Each file is handled once per page visit. If you un-view or expand a file by hand, it stays that way until you reload.
- On PR pages, a **Mark tests viewed** button (bottom-right) and a userscript menu command scroll through the whole page and mark every matching file, including ones GitHub hasn't rendered yet.
- Log lines are printed to the console with the `[mark-tests]` prefix.

## License

[MIT](./LICENSE)
