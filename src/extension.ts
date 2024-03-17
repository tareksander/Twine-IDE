import { spawnSync } from 'child_process';
import { Dir, } from 'fs';
import { opendir } from 'fs/promises';
import * as vscode from 'vscode';

const utf8 = new TextDecoder("utf-8");

export class Passage extends vscode.TreeItem {
    public name: string = "";
    public line: number = 1;
}

export class PassagesProvider implements vscode.TreeDataProvider<Passage> {
    private onChange = new vscode.EventEmitter<void | Passage | Passage[] | null | undefined>();
    public data: Passage[] = [];
    onDidChangeTreeData?: vscode.Event<void | Passage | Passage[] | null | undefined> | undefined = this.onChange.event;
    getTreeItem(element: Passage): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }
    getChildren(element?: Passage | undefined): vscode.ProviderResult<Passage[]> {
        if (! element) {
            return this.data;
        } else {
            return [];
        }
    }
    
    public refresh() {
        this.onChange.fire();
    }
    
    /*
    getParent?(element: Passage): vscode.ProviderResult<Passage> {
        throw new Error('Method not implemented.');
    }
    resolveTreeItem?(item: vscode.TreeItem, element: Passage, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
        throw new Error('Method not implemented.');
    }
    */
}

class StoryPanel {
    public static readonly viewType = "twine.story";
    
    private panel?: vscode.WebviewPanel;
    private root: string;
    
    constructor(root: string) {
        this.root = root;
    }
    
    reset(p: vscode.WebviewPanel) {
        this.panel?.dispose();
        this.panel = p;
        this.register();
    }
    
    private register() {
        this.panel!.webview.html = this.html();
        let d = vscode.workspace.onDidSaveTextDocument((e) => {
            if (this.panel?.visible) {
                this.panel!.webview.html = this.html();
            }
        });
        this.panel!.onDidDispose(() => {
            this.panel = undefined;
            d.dispose();
        });
    }
    
    open() {
        if (! this.panel) {
            this.panel = vscode.window.createWebviewPanel(StoryPanel.viewType, "Story", {
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: true
            }, {
                enableScripts: true,
                localResourceRoots: []
            });
        } else {
            this.panel?.reveal();
            return;
        }
        this.register();
    }
    
    html(): string {
        let p = spawnSync("twee", ["build", "-s", "-d"], {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: this.root
        });
        if (p.status !== 0) {
            return "Twee error:\n" + utf8.decode(p.stderr);
        } else {
            if (p.stderr.length !== 0) {
                vscode.window.showWarningMessage("Twee warnings:\n" + utf8.decode(p.stderr));
            }
            return utf8.decode(p.stdout);
        }
    }
    
}

const passageRegexp = /^::([^\n[{]*)([^\n]*(\[[^\n]*\]))?([^\n]*(\{[^\n]*\}))?\n/gmu;
const newlineRegexp = /\r\n|\r|\n/;

async function findPassages(): Promise<Passage[]> {
    let files = await vscode.workspace.findFiles("**/*.{tw,twee}");
    return (await Promise.all(files.map(async (f) => {
        let content = utf8.decode((await vscode.workspace.fs.readFile(f)));
        let passages = content.matchAll(passageRegexp);
        let p;
        let ret: Passage[] = [];
        for (p of passages) {
            let name = (p.at(1) as string).trim();
            if (! ret.every((e) => e.name !== name)) {
                continue;
            }
            let tags = p.at(3);
            //let meta = p.at(5);
            let pass = new Passage(name);
            pass.name = name;
            if (tags) {
                pass.label += "  " + tags;
            }
            pass.resourceUri = f;
            pass.line = content.substring(0, p.index as number).split(newlineRegexp).length - 1;
            pass.command = {
                command: "twine-ide.goto",
                title: "goto",
                arguments: [f, pass.line]
            };
            
            ret.filter((e) => {
                
            });
            ret.push(pass);
        }
        return ret;
    }))).flat();
}


export function activate(context: vscode.ExtensionContext) {
    let twee = false;
    if (spawnSync("twee", ["-V"], {
        stdio: "ignore",
    }).status !== 0) {
        vscode.window.showErrorMessage("Please install Twee Tools to use the Twine IDE extension", "Install").then((v) => {
            if (v === "Install") {
                vscode.env.openExternal(vscode.Uri.parse("https://github.com/tareksander/twine-rs/tree/main/twee-tools#installation"));
            }
        });
    } else {
        twee = true;
    }
    let folders = vscode.workspace.workspaceFolders;
    if (twee && folders && folders.length === 1) {
        let root = folders[0].uri.fsPath;
        let sv = new StoryPanel(root);
        context.subscriptions.push(vscode.commands.registerCommand('twine-ide.build', () => {
            let p = spawnSync("twee", ["build"], {
                stdio: ['ignore', 'pipe', 'pipe'],
                cwd: root
            });
            if (p.status !== 0) {
                vscode.window.showErrorMessage("Twee error:\n" + p.stderr);
            } else {
                if (p.stderr.length !== 0) {
                    vscode.window.showWarningMessage("Twee warnings:\n" + p.stderr);
                }
            }
        }));
        context.subscriptions.push(vscode.commands.registerCommand('twine-ide.goto', (f, line) => {
            vscode.workspace.openTextDocument(f).then((d) => {
               vscode.window.showTextDocument(d).then(() => {
                    let e = vscode.window.activeTextEditor;
                    if (e) {
                        let pos = new vscode.Position(line, 0);
                        e.selection = new vscode.Selection(pos, pos);
                        e.revealRange(new vscode.Range(pos, pos));
                    }
               }) ;
            });
        }));
        context.subscriptions.push(vscode.commands.registerCommand('twine-ide.run', () => {
            sv.open();
        }));
        let buildItem = vscode.window.createStatusBarItem("twine.build", vscode.StatusBarAlignment.Left);
        let runItem = vscode.window.createStatusBarItem("twine.run", vscode.StatusBarAlignment.Left);
        buildItem.command = "twine-ide.build";
        buildItem.text = "$(symbol-property) Build";
        runItem.command = "twine-ide.run";
        runItem.text = "$(run) Run";
        buildItem.show();
        runItem.show();
        context.subscriptions.push(buildItem);
        context.subscriptions.push(runItem);
        {
            let pp = new PassagesProvider();
            findPassages().then((d) => {
                pp.data = d;
                pp.refresh();
            });
            context.subscriptions.push(vscode.commands.registerCommand('twine-ide.refresh', () => {
                findPassages().then((d) => {
                    pp.data = d;
                    pp.refresh();
                });
            }));
            let tv = vscode.window.createTreeView("passages", { treeDataProvider: pp});
            let tv2 = vscode.window.createTreeView("explorer-passages", { treeDataProvider: pp});
            vscode.workspace.onDidChangeTextDocument((e) => {
                let docuri = e.document.uri;
                if ((tv.visible || tv2.visible) && e.document.languageId === "twee3") {
                    let visited: string[] = [];
                    let passages = e.document.getText().matchAll(passageRegexp);
                    for (let p of passages) {
                        let name = (p.at(1) as string).trim();
                        if (visited.includes(name)) {
                            continue;
                        }
                        visited.push(name);
                        let tags = p.at(3);
                        let found = pp.data.find((e) => e.name === name && e.resourceUri?.toString() === docuri.toString());
                        let line = e.document.getText().substring(0, p.index as number).split(newlineRegexp).length - 1;
                        let newp = found === undefined;
                        if (! found) {
                            found = new Passage(name);
                            found.resourceUri = docuri;
                        }
                        if (tags) {
                            found.label = name + "  " + tags;
                        } else {
                            found.label = name;
                        }
                        found.line = line;
                        found.command = {
                            command: "twine-ide.goto",
                            title: "goto",
                            arguments: [docuri, found.line]
                        };
                        if (newp) {
                            pp.data.push(found);
                        }
                    }
                    pp.data = pp.data.filter((e) => {
                        return e.resourceUri?.toString() !== docuri.toString() || visited.includes(e.name);
                    });
                    pp.refresh();
                }
            });
            context.subscriptions.push(tv);
            context.subscriptions.push(tv2);
        }
        context.subscriptions.push(vscode.window.registerWebviewPanelSerializer(StoryPanel.viewType, {
            async deserializeWebviewPanel(p, s) {
                console.log(s);
                sv.reset(p);
                sv.open();
            },
        }));
    }
}

// This method is called when your extension is deactivated
export function deactivate() { }
