// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { EventEmitter } from "events";
import * as path from "path";
import * as crypto from "crypto";
import * as promiseFs from "fs/promises";
import * as fs from "fs";
import * as chokidar from 'chokidar';

const STORAGE_NAME = ".mymy"
let WORKSPACE_PATH = ""
let STORAGE_PATH = ""

// TODO: ここよく理解できていないので確認する
let watcher: chokidar.FSWatcher | null = null; // ✅ グローバルに `watcher` を保持

const stateChanged = new EventEmitter(); // 🔥 状態変更イベント (useEffect 相当)

// 状態変更のイベントを検知
stateChanged.on("update", () => {
	const editor = vscode.window.activeTextEditor;
    if (editor) applyDecorations(editor);
});

// const [memo, setMemo] = useState<Map<string, string>>(null)のイメージ
const memo: Map<string, string> = new Map()

const setMemo = (callback: () => void) => {
	callback()
	stateChanged.emit("update"); // 🔥 状態変更を通知
}

const loadMemo = () => {
	const entiries = fs.readdirSync(STORAGE_PATH, { withFileTypes: true});
	entiries.filter((entry) => entry.isFile()).map((entry) => {
		const contentPath = path.join(STORAGE_PATH, entry.name);
		const content = fs.readFileSync(contentPath, "utf8");
		memo.set(entry.name, content)
	})
}

const watchStorage = async () => {
	if (watcher) {
        await watcher.close();
    }
	// 監視の開始
	watcher = chokidar.watch(STORAGE_PATH, {
		persistent: true, // プログラムを実行し続ける
		ignoreInitial: true,
	});

	// イベントを設定
	watcher
		.on('add', (filePath) => {
			console.log(`✅ ファイルが作成されました: ${filePath}`)
		})
		.on('change', (filePath) => {
			const content = fs.readFileSync(filePath, "utf8"); // TODO ファイル読み込みの非同期化
			const name = path.basename(filePath)
			setMemo(() => {
				memo.set(name, content)
			})
			console.log(memo)
		})
		.on('unlink', (filePath) => {
			const name = path.basename(filePath)
			setMemo(() => {
				memo.delete(name)
			})
		})
		.on('error', (error) => console.error(`🚨 監視エラー: ${error}`));
}

const getSha1 = (text: string): string => {
    return crypto.createHash("sha1").update(text).digest("hex");
};

// 拡張機能がアクティブになったタイミングで./mymyディレクトリをセットアップ
const setUp = async () => {
	// ワークスペースが開かれているか確認
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders || workspaceFolders.length === 0) {
		vscode.window.showWarningMessage('You have to open workspace');
		return;
	}

	WORKSPACE_PATH = workspaceFolders[0].uri.fsPath;
	
	STORAGE_PATH = path.join(WORKSPACE_PATH, STORAGE_NAME);
	try {
		await promiseFs.mkdir(STORAGE_PATH, { recursive: true });
	} catch (error) {
		console.error("Error creating directory:", error);
	}
}

const helloWorld = () => {
	// The code you place here will be executed every time your command is executed
	// Display a message box to the user
	vscode.window.showInformationMessage('Hello World from mymy!');
}

const hoverProvider: vscode.HoverProvider = {
	provideHover(document, position, token) {
		// TODO: 修正 memoStateはグローバルに定義する
		const memoState = getMemo()
		const createDocCommand = `[📝 ドキュメントを作成](command:mymy.createDocumentation?${encodeURIComponent(JSON.stringify({ line: position.line }))})`; // 今後プロパティを増やす予定はないが...
		const lineText = document.lineAt(position.line).text;
        const lineHash = getSha1(lineText);
		
		let memoContent = memoState[lineHash] || `📌 **この行の説明を作成しますか？**\n\n${createDocCommand}`;

		const hoverContent = new vscode.MarkdownString();
        hoverContent.appendMarkdown(memoContent);
		// ポップアップ上のリンクの制限を解除
		hoverContent.isTrusted = true;
		return new vscode.Hover(hoverContent);
	}
}

const createDocumentation = async (args: any) => {
	const editor = vscode.window.activeTextEditor;
	if (!editor) return;
	// argsでlineプロパティを取得
	const line = args?.line ?? editor.selection.active.line;
    const lineText = editor.document.lineAt(line).text;
    const lineHash = getSha1(lineText);
	const contentPath = path.join(STORAGE_PATH, lineHash);

	// メモのデフォルトテンプレート
    const defaultContent = `#### title
- Usage 

\`\`\`bash
$  
\`\`\`

[✏️ 編集する](command:mymy.editDocumentation?${encodeURIComponent(JSON.stringify({ line: line }))})
[🗑️ 削除する](command:mymy.deleteDocumentation?${encodeURIComponent(JSON.stringify({ line: line }))})
`;


	// メモファイルが存在しない場合は空のファイルを作成
    if (!fs.existsSync(contentPath)) {
        await fs.promises.writeFile(contentPath, defaultContent, "utf8");
    }

	// ファイルを開く（右側のエディタ）
    const doc = await vscode.workspace.openTextDocument(contentPath);
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });

}


const editDocumentation = async (args: any) => {
	const editor = vscode.window.activeTextEditor;
	if (!editor) return;
	// argsでlineプロパティを取得
	const line = args?.line ?? editor.selection.active.line;
    const lineText = editor.document.lineAt(line).text;
    const lineHash = getSha1(lineText);
	const contentPath = path.join(STORAGE_PATH, lineHash);

	// 右側のエディタで開く
    const doc = await vscode.workspace.openTextDocument(contentPath);
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });

}

const deleteDocumentation = async (args: any) => {
	const editor = vscode.window.activeTextEditor;
	if (!editor) return;
	// argsでlineプロパティを取得
	const line = args?.line ?? editor.selection.active.line;
    const lineText = editor.document.lineAt(line).text;
    const lineHash = getSha1(lineText);
	const contentPath = path.join(STORAGE_PATH, lineHash);

	try {
		await fs.promises.unlink(contentPath)
	} catch (error: any) {
		console.log("Error: ", error)
	}
}

// TODO: 後からキャッシュに差し替える. 現状はファイルシステムを読み込む
const getMemo = (): Record<string, string> => {
	const entiries = fs.readdirSync(STORAGE_PATH, { withFileTypes: true});
	const res: Record<string, string> = {};
	entiries.filter((entry) => entry.isFile()).map((entry) => {
		const contentPath = path.join(STORAGE_PATH, entry.name);
		const content = fs.readFileSync(contentPath, "utf8");
		res[entry.name] = content
	})
	return res
}

// グローバルに定義
let memoDecorationType: vscode.TextEditorDecorationType;

const applyDecorations = (editor: vscode.TextEditor) => {
	console.log("applyDecoration is called")
    if (!memoDecorationType) {
        memoDecorationType = vscode.window.createTextEditorDecorationType({});
    }

    // const memoState = getMemo();
    editor.setDecorations(memoDecorationType, []);

    const decorations: vscode.DecorationOptions[] = [];

    for (let i = 0; i < editor.document.lineCount; i++) {
        const line = editor.document.lineAt(i);
        const lineHash = getSha1(line.text);
        // const memoContent = memoState[lineHash];
		const memoContent = memo.get(lineHash)

        if (memoContent) {
            const range = new vscode.Range(
                new vscode.Position(i, line.range.end.character),
                new vscode.Position(i, line.range.end.character)
            );

            decorations.push({
                range,
                renderOptions: {
                    after: {
                        contentText: ` 📌 ${memoContent}`, // メモの一行目を表示
                        color: "#888888",
                        margin: "0 0 10px",
                    },
                },
            });
        }
    }
    editor.setDecorations(memoDecorationType, decorations);
};


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export const activate = (context: vscode.ExtensionContext) => {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "mymy" is now active!');

	// .mymyディレクトリの作成
	setUp()

	loadMemo()

	// ストレージの監視を開始
	watchStorage()

	context.subscriptions.push(
		// The command has been defined in the package.json file
		// Now provide the implementation of the command with registerCommand
		// The commandId parameter must match the command field in package.json
		vscode.commands.registerCommand('mymy.helloWorld',helloWorld),
		vscode.commands.registerCommand('mymy.createDocumentation', createDocumentation),
		vscode.commands.registerCommand('mymy.editDocumentation', editDocumentation),
		vscode.languages.registerHoverProvider('*', hoverProvider),
		{
			dispose: () => {
				dispose: () => {
					if (watcher) {
						watcher.close()
					}
				}
			}
		},
		vscode.commands.registerCommand('mymy.deleteDocumentation', deleteDocumentation)
	);

	// (初回適用) 現在開いているファイルに対してapplyDecorationsを適用
    const editor = vscode.window.activeTextEditor;
    if (editor) applyDecorations(editor);

	// 開いているファイルの内容が変化したときに発火
    vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
            applyDecorations(editor);
        }
    });
	
	// 開くファイルを変更したときに発火
    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) applyDecorations(editor);
    });
}

// This method is called when your extension is deactivated
export function deactivate() {
	if (watcher) watcher.close()
}
