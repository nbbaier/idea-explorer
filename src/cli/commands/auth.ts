import { Command } from "commander";
import { getApiKey, setApiKey } from "../lib/config.js";

function loginAction(token: string): void {
  setApiKey(token);
  console.log("API token saved successfully.");
}

function statusAction(): void {
  const token = getApiKey();
  if (token) {
    const masked = `${token.slice(0, 4)}...${token.slice(-4)}`;
    console.log(`Authenticated (token: ${masked})`);
  } else {
    console.log("Not authenticated. Run 'idea auth login <token>' to set up.");
  }
}

export function createAuthCommand(): Command {
  const auth = new Command("auth").description("Manage authentication");

  auth
    .command("login")
    .description("Save your API token")
    .argument("<token>", "Your API token")
    .action(loginAction);

  auth
    .command("status")
    .description("Check authentication status")
    .action(statusAction);

  return auth;
}
