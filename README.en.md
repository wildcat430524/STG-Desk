<div align="center">
  <img src="build/icon.png" alt="STG Desk icon" width="96" height="96">
  <h1>STG Desk</h1>
  <p><strong>Read lessons, write answers, and follow your progress in one workspace.</strong></p>
  <p>Windows portable app · Local Markdown · DeepSeek Harness integration</p>
  <p>
    <a href="https://github.com/wildcat430524/STG-Desk/releases/latest"><img src="https://img.shields.io/github/v/release/wildcat430524/STG-Desk?style=flat-square&amp;label=release" alt="Latest release"></a>
    <img src="https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square" alt="Platform: Windows">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4B5563?style=flat-square" alt="License: MIT"></a>
  </p>
  <p>
    <strong><a href="https://github.com/wildcat430524/STG-Desk/releases/latest">Download for Windows</a></strong>
    · <a href="#quick-start">Quick start</a>
    · <a href="https://github.com/wildcat430524/STG-Desk/issues">Report an issue</a>
  </p>
  <p><a href="README.md">简体中文</a> | <strong>English</strong></p>
</div>

STG Desk is a Windows desktop workspace for [StepsToGreat](https://github.com/wildcat430524/StepsToGreat) learning directories. Open a local learning folder to find your current lesson, write answers beside the teaching document, and review previous feedback and recorded progress. For AI evaluation or discussion, connect to **DeepSeek Harness (DSH)** on your computer and continue in a native learning session.

Reading, editing, and answering work independently; connect DSH when needed. Learning files stay in their original directory so a tutor or learning agent can read and update them.

> This README describes the current source. Downloaded builds follow their [release notes](https://github.com/wildcat430524/STG-Desk/releases); source updates may not yet be available in the latest portable build. The app interface is currently in Chinese.

## Preview

Teaching, answers, current chapter progress, and overall progress have separate entries. Documents can open in detached windows, and DSH offers a side panel or a floating window.

![Learning workspace with teaching, answers, and the DSH panel](docs/screenshots/workspace.png)

<details>
<summary><strong>More screenshots</strong></summary>

| Document editing | Learning progress |
| --- | --- |
| ![WYSIWYG editing](docs/screenshots/visual-editor.png) | ![Overall progress and mastery records](docs/screenshots/overall-progress.png) |

| Detached teaching window | Detached answer window |
| --- | --- |
| ![Teaching window](docs/screenshots/teaching-window.png) | ![Answer window](docs/screenshots/student-window.png) |

<img src="docs/screenshots/dsh-floating.png" alt="DSH floating window before connection" width="420">

</details>

Screenshots use demo lessons and test drafts, with no real learning records or model responses. Some control layouts may predate the current source.

## Features

- **Pick up where you left off**: restore the last workspace, locate the current lesson from the learning profile, or choose an existing lesson.
- **Edit documents directly**: single-column WYSIWYG editing with code, tables, checklists, math, and local images. Unchanged blocks retain their original Markdown.
- **Answer beside the lesson**: fill in the current round, insert code blocks, and append your answers. Review previous answers, evaluations, and reassessments.
- **Edit the full answer document**: open the answer page directly or view and edit the complete student document beside the lesson.
- **Follow recorded progress**: read chapter progress, overall progress, handoff status, and mastery records from existing documents.
- **Read your way**: detached teaching and answer windows, font size, line spacing, reading width, night theme, and focus mode.
- **Use native DSH sessions**: live messages and model selection come from your local DSH. The panel and floating window share the conversation and input draft.
- **Review and recover saves**: automatic drafts, backups before writes, version checks, external-change alerts, manual merging, and history restoration.

The app displays existing records. Mastery decisions, tutor evaluations, and new lessons are supplied by the tutor or learning agent.

## Quick start

1. Download `STG-Desk-<version>-Windows.exe` from the [latest release](https://github.com/wildcat430524/STG-Desk/releases/latest) and run it. No separate Node.js or Electron installation is needed.
2. Click 「导入学习文件夹」 (Import learning folder), or drag a folder from File Explorer into the app. Select the workspace root containing the learning profile and lessons.
3. Click 「继续学习」 (Continue learning) for the current lesson, or 「选择课程」 (Choose lesson) to open an existing lesson.
4. Read the lesson, enter answers beside it, and click 「保存本轮作答」 (Save this round). Alternatively, edit the answer page directly and click 「保存」 (Save) or press `Ctrl+S`.
5. For AI evaluation, start DSH Desktop, open the DSH panel in STG Desk, connect, and send an evaluation request.

If you have no learning files yet, try the [bundled demo lessons](demo/StepsToGreat) from the welcome screen. Importing reads the original files; saving writes to the original learning directory without making a separate copy.

<details>
<summary><strong>Learning directory and document pairing</strong></summary>

The demo uses this structure:

```text
StepsToGreat/
├─ README.md
└─ 我的学习/
   ├─ 00-学习档案.md
   └─ 学科/
      └─ Python/
         └─ 01-认识变量/
            ├─ 01_教学引导.md
            └─ 01_学生回答.md
```

Teaching and answer documents share a filename prefix and directory so the app can pair them. The current lesson comes from the learning profile's handoff status. If a lesson is missing, check the imported root, document paths in the profile, and document pairing.

</details>

## Usage

### Reading and answering

Click headings, text, checklists, or tables to edit directly; double-click inline math to edit it. Document information and controls sit at the bottom, with reading settings, a night theme, and 「专注」 (Focus). Press `Esc` or use the exit control to leave focus mode.

The answer workspace beside the lesson has three entries:

| Entry | Purpose |
| --- | --- |
| 「本轮作答」 (Current round) | Answer the latest published round; saving appends your original answers |
| 「作答记录」 (Answer records) | Review previous answers, tutor evaluations, and final reassessments |
| 「完整文档」 (Full document) | Read and edit the entire answer file, including content outside the question interface |

Question-based input supports ordinary and Feynman rounds with 1–3 recognized questions in the current round. For more questions or unrecognized formatting, edit the full answer document. Save pending full-document edits before submitting question-based answers.

**Automatic drafts help recover input; saving the actual document still requires an explicit save.** Round submissions preserve previous answers and evaluations and do not update mastery tables or handoff status automatically.

### Detached windows

Click 「开窗口 ↗」 (Open window) on the teaching or answer page. The main app switches to the other document and temporarily disables the detached document's entry; progress pages remain accessible. Closing the detached window returns the main app to that document and restores its draft.

Detached windows keep their original document and workspace when the main window switches lessons, switches directories, or closes. Windows have separate drafts and share a save queue with version checks when writing to the same file.

### DSH integration

Start **DeepSeek Harness Desktop** and configure an available model, then open the DSH panel in STG Desk and click 「连接」 (Connect). The first connection creates a dedicated session for the learning directory; subsequent connections restore it. You can also choose an existing session for that directory or create a new one. The DSH panel stays closed at app startup.

Your local DSH manages the model catalog, accounts, and quotas. Save your answers before sending an evaluation request so the learning agent can read the document.

[dsh-stg-learning](https://github.com/wildcat430524/dsh-stg-learning) is a separate DSH learning-management plugin for organizing workspaces and sessions. It is not required to connect STG Desk to DSH.

<details>
<summary><strong>DSH version and connection settings</strong></summary>

The verified DSH Desktop version is **0.2.0-rc.2**, with the default address `http://127.0.0.1:19387`. If you use a different local port or configuration directory, set only the values that need changing before starting STG Desk:

```powershell
$env:STG_DSH_DESKTOP_URL = 'http://127.0.0.1:19387'
$env:DSH_HOME = 'C:\YourDSHConfig'
& 'C:\YourAppFolder\STG-Desk-<version>-Windows.exe'
```

Only local HTTP addresses are accepted. Desktop connection authorization is read in the main process; the app does not copy model accounts or keys. Compatibility with other DSH versions requires verification.

</details>

## Data and recovery

| Data | Location |
| --- | --- |
| Teaching, answers, and learning profiles | Markdown files in the original learning directory |
| History backups | `.stg-desk/backups/` in the learning directory; 20 versions per document by default, configurable from 5 to 100 |
| Unsaved documents and answer drafts | System app settings directory; detached windows have their own draft directories |
| Recent workspace and reading settings | System app settings directory |
| DSH sessions and model configuration | Managed by DSH |

Before saving, the app checks the file version, backs up the old content, and replaces the file through a temporary file. External changes prompt a reload or manual merge. Restoring a history version also backs up the current content first.

Drafts are written about 250 milliseconds after input pauses; restoring a draft does not automatically overwrite the original file. Local backups are not cloud synchronization. Keep separate backups of important learning files.

## FAQ

<details>
<summary><strong>Can I use it without DSH?</strong></summary>

Yes, for reading, editing, and answering. AI messages require a running local DSH Desktop with an available model configuration. Previously loaded history remains readable after DSH closes.

</details>

<details>
<summary><strong>Which file formats are supported?</strong></summary>

UTF-8 Markdown/TXT, up to 8 MB per file, including UTF-8 BOM and CRLF. PDF and DOCX are outside the parser's scope; Mermaid remains a code block. Workspace images can load, while remote images are disabled by default.

</details>

<details>
<summary><strong>Why does Windows show a warning?</strong></summary>

The portable build is currently unsigned. Download from this repository's Releases and verify the file against the provided `SHA256SUMS.txt`.

</details>

## Development and build

Requires **Node.js 22.12+**; CI uses Node.js 24. Full desktop functionality requires the Electron host.

```powershell
git clone https://github.com/wildcat430524/STG-Desk.git
cd STG-Desk
npm ci
npm start
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start a Vite interface preview; full desktop file operations are unavailable in the browser |
| `npm run build` | Build the frontend into `dist/` |
| `npm test` | Run parsing, navigation, file-saving, draft, and DSH protocol tests |
| `npm run test:desktop` | Build and run the Electron desktop smoke checks |
| `npm run pack` | Create a Windows directory build; keep the entire `release/win-unpacked/` directory when running it |
| `npm run dist` | Create `release/STG-Desk-<version>-Windows.exe` |

For desktop UI development, run `npm run dev`, then set `$env:STG_DEV_URL='http://127.0.0.1:5178'` in another terminal and run `npx electron .`.

<details>
<summary><strong>Source layout and technology</strong></summary>

```text
electron/          Desktop windows, IPC, DSH control, detached documents
src/               Learning pages, answer workspace, editors, styles
lib/               Navigation, parsing, file saving, drafts, DSH services
tests/             Logic tests and desktop checks
demo/              Demo lessons
docs/screenshots/  README screenshots
.github/workflows/ Windows verification, build, and release
```

The WYSIWYG editor uses **Tiptap / ProseMirror**. markdown-it / KaTeX render documents, DOMPurify sanitizes output, chokidar watches file changes, and Vite / electron-builder build and package the app.

Raw HTML rendering is disabled, and renderer processes have no Node access. File access is restricted to the imported directory, excluding hidden directories, symbolic links, and dependency/build directories.

Windows CI installs dependencies, runs logic tests, and builds the portable app. Desktop smoke checks can be run locally. See [GitHub Actions](https://github.com/wildcat430524/STG-Desk/actions) for build status.

</details>

## Contributing

[Issues](https://github.com/wildcat430524/STG-Desk/issues) and pull requests are welcome. Include the app version, DSH version when relevant, reproduction steps, and expected behavior. For parsing issues, attach a minimal Markdown example with personal information removed.

Run relevant tests for changes to saving, backups, parsing, or window behavior. For UI changes, include screenshots using demo data and check narrow windows and the system's reduced-motion setting.

## License

New project code is licensed under [MIT](LICENSE). Third-party licenses are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and the dependencies' own LICENSE files.
