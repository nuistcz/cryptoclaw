import readline from "node:readline";
import chalk from "chalk";
import type { Command } from "commander";
import { resolveStateDir } from "../config/paths.js";
import { defaultRuntime } from "../runtime.js";
import { renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";

type WalletManager =
  import("../../extensions/blockchain/src/wallet/wallet-manager.js").WalletManager;

async function loadWalletManager(stateDir: string): Promise<WalletManager> {
  let mod: typeof import("../../extensions/blockchain/src/wallet/wallet-manager.js");
  try {
    mod = await import("../../extensions/blockchain/src/wallet/wallet-manager.js");
  } catch {
    throw new Error(
      "Blockchain extension not available. " +
        "Ensure the blockchain extension is installed in your workspace.",
    );
  }
  return new mod.WalletManager(stateDir);
}

/** Prompt for a secret value without echoing characters. */
function promptSecret(message: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    process.stdout.write(`${message}: `);
    // Mute echoing by overriding _writeToOutput
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    rl.question("", (answer) => {
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

export function registerWalletCli(program: Command) {
  const wallet = program
    .command("wallet")
    .description("Manage EVM wallets (add, import, list, switch, export)");

  // wallet add — create new wallet
  wallet
    .command("add")
    .alias("create")
    .description("Create a new wallet with a generated private key")
    .option("-l, --label <label>", "Wallet label", "Default")
    .action(async (opts: { label: string }) => {
      const stateDir = resolveStateDir();
      let wm: WalletManager;
      try {
        wm = await loadWalletManager(stateDir);
      } catch (err) {
        defaultRuntime.log(theme.error(String(err)));
        process.exit(1);
      }
      const passphrase = await promptSecret("Passphrase (min 8 chars)");
      if (passphrase.length < 8) {
        defaultRuntime.log(theme.error("Passphrase must be at least 8 characters."));
        process.exit(1);
      }
      const confirm = await promptSecret("Confirm passphrase");
      if (confirm !== passphrase) {
        defaultRuntime.log(theme.error("Passphrases do not match."));
        process.exit(1);
      }
      defaultRuntime.log("Creating wallet...");
      const w = await wm.createWallet(opts.label, passphrase);
      defaultRuntime.log(
        theme.success(`Wallet created!`) +
          `\n  Label:   ${w.label}\n  Address: ${w.address}\n\nBack up your passphrase — it cannot be recovered.`,
      );
    });

  // wallet import — import existing private key
  wallet
    .command("import")
    .description("Import an existing wallet by private key")
    .option("-l, --label <label>", "Wallet label", "Imported")
    .action(async (opts: { label: string }) => {
      const stateDir = resolveStateDir();
      let wm: WalletManager;
      try {
        wm = await loadWalletManager(stateDir);
      } catch (err) {
        defaultRuntime.log(theme.error(String(err)));
        process.exit(1);
      }
      const privateKey = await promptSecret("Private key (0x...)");
      if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
        defaultRuntime.log(
          theme.error("Invalid private key. Expected 0x followed by 64 hex characters."),
        );
        process.exit(1);
      }
      const passphrase = await promptSecret("Passphrase to encrypt this wallet (min 8 chars)");
      if (passphrase.length < 8) {
        defaultRuntime.log(theme.error("Passphrase must be at least 8 characters."));
        process.exit(1);
      }
      defaultRuntime.log("Importing wallet...");
      const w = await wm.importWallet(privateKey as `0x${string}`, opts.label, passphrase);
      defaultRuntime.log(
        theme.success(`Wallet imported!`) + `\n  Label:   ${w.label}\n  Address: ${w.address}`,
      );
    });

  // wallet list — list all wallets
  wallet
    .command("list")
    .alias("ls")
    .description("List all wallets")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const stateDir = resolveStateDir();
      let wm: WalletManager;
      try {
        wm = await loadWalletManager(stateDir);
      } catch (err) {
        defaultRuntime.log(theme.error(String(err)));
        process.exit(1);
      }
      const { wallets, activeWalletId } = wm.listWallets();
      if (wallets.length === 0) {
        defaultRuntime.log("No wallets found. Run: " + chalk.bold("cryptoclaw wallet add"));
        return;
      }
      if (opts.json) {
        defaultRuntime.log(JSON.stringify({ wallets, activeWalletId }, null, 2));
        return;
      }
      const rows: Record<string, string>[] = wallets.map((w) => ({
        active: w.id === activeWalletId ? theme.success("●") : " ",
        label: w.label,
        address: w.address,
        created: new Date(w.createdAt).toLocaleDateString(),
      }));
      defaultRuntime.log(
        renderTable({
          columns: [
            { key: "active", header: "", minWidth: 2 },
            { key: "label", header: "Label" },
            { key: "address", header: "Address" },
            { key: "created", header: "Created" },
          ],
          rows,
        }),
      );
    });

  // wallet use — switch active wallet
  wallet
    .command("use <label-or-id>")
    .alias("switch")
    .description("Set the active wallet by label or ID")
    .action(async (labelOrId: string) => {
      const stateDir = resolveStateDir();
      let wm: WalletManager;
      try {
        wm = await loadWalletManager(stateDir);
      } catch (err) {
        defaultRuntime.log(theme.error(String(err)));
        process.exit(1);
      }
      try {
        const w = wm.switchWallet(labelOrId);
        defaultRuntime.log(
          theme.success(`Active wallet set to: ${w.label}`) + `\n  Address: ${w.address}`,
        );
      } catch (err) {
        defaultRuntime.log(theme.error(String(err)));
        process.exit(1);
      }
    });

  // wallet delete — delete a wallet
  wallet
    .command("delete <label-or-id>")
    .alias("remove")
    .description("Delete a wallet (requires passphrase)")
    .action(async (labelOrId: string) => {
      const stateDir = resolveStateDir();
      let wm: WalletManager;
      try {
        wm = await loadWalletManager(stateDir);
      } catch (err) {
        defaultRuntime.log(theme.error(String(err)));
        process.exit(1);
      }
      const passphrase = await promptSecret("Passphrase to confirm deletion");
      try {
        await wm.deleteWallet(labelOrId, passphrase);
        defaultRuntime.log(theme.success(`Wallet deleted: ${labelOrId}`));
      } catch (err) {
        defaultRuntime.log(theme.error(String(err)));
        process.exit(1);
      }
    });

  // wallet export — export private key
  wallet
    .command("export <label-or-id>")
    .description("Export a wallet's private key (sensitive — handle with care)")
    .action(async (labelOrId: string) => {
      const stateDir = resolveStateDir();
      let wm: WalletManager;
      try {
        wm = await loadWalletManager(stateDir);
      } catch (err) {
        defaultRuntime.log(theme.error(String(err)));
        process.exit(1);
      }
      const passphrase = await promptSecret("Passphrase");
      try {
        const privateKey = await wm.exportWallet(labelOrId, passphrase);
        defaultRuntime.log(
          theme.warn("⚠ Keep this private key secret. Never share it.\n") +
            `Private key: ${privateKey}`,
        );
      } catch (err) {
        defaultRuntime.log(theme.error(String(err)));
        process.exit(1);
      }
    });

  // wallet active — show active wallet
  wallet
    .command("active")
    .description("Show the currently active wallet address")
    .action(async () => {
      const stateDir = resolveStateDir();
      let wm: WalletManager;
      try {
        wm = await loadWalletManager(stateDir);
      } catch (err) {
        defaultRuntime.log(theme.error(String(err)));
        process.exit(1);
      }
      const address = wm.getActiveAddress();
      if (!address) {
        defaultRuntime.log("No active wallet. Run: " + chalk.bold("cryptoclaw wallet add"));
        return;
      }
      const { wallets, activeWalletId } = wm.listWallets();
      const w = wallets.find((x) => x.id === activeWalletId);
      defaultRuntime.log(
        theme.success("Active wallet") + `\n  Label:   ${w?.label ?? "—"}\n  Address: ${address}`,
      );
    });
}
