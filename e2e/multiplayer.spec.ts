import { expect, test } from "@playwright/test";

test("three players can run a duplicate-clue round", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const charlieContext = await browser.newContext();

  const host = await hostContext.newPage();
  const bob = await bobContext.newPage();
  const charlie = await charlieContext.newPage();

  await host.goto("/");
  await host.getByLabel("Display name").fill("Alice");
  await host.getByRole("button", { name: "Create room" }).click();
  await expect(host.getByRole("button", { name: "Start game" })).toBeVisible();

  const roomCode = new URL(host.url()).pathname.split("/room/")[1];
  expect(roomCode).toBeTruthy();
  await expect(host.getByText(`Room code: ${roomCode}`)).toBeVisible();
  await expect(host.getByText("Join link")).toBeVisible();

  await joinRoom(bob, roomCode, "Bob");
  await expect(host.getByText("Bob")).toBeVisible();
  await joinRoom(charlie, roomCode, "Charlie");
  await expect(host.getByText("Charlie")).toBeVisible();

  await expect(host.getByText("Charlie")).toBeVisible();
  await host.getByRole("button", { name: "Start game" }).click();

  await expect(host.getByText("0/2 clues submitted")).toBeVisible();
  await submitClue(bob, "same");
  await submitClue(charlie, "same!");

  await expect(bob.getByText("2 duplicate clues auto-deleted.")).toBeVisible();
  await expect(bob.getByText("same")).toHaveCount(0);
  await bob.getByRole("button", { name: "Reveal valid clues" }).click();

  await expect(host.getByText("Guessing")).toBeVisible();
  await host.getByRole("button", { name: "Pass", exact: true }).click();
  await expect(host.getByText("Passed")).toBeVisible();

  await hostContext.close();
  await bobContext.close();
  await charlieContext.close();
});


test("wrong guess burns one extra scoring card", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const charlieContext = await browser.newContext();

  const host = await hostContext.newPage();
  const bob = await bobContext.newPage();
  const charlie = await charlieContext.newPage();

  await host.goto("/");
  await host.getByLabel("Display name").fill("Alice");
  await host.getByRole("button", { name: "Create room" }).click();

  const roomCode = new URL(host.url()).pathname.split("/room/")[1];
  await joinRoom(bob, roomCode, "Bob");
  await expect(host.getByText("Bob")).toBeVisible();
  await joinRoom(charlie, roomCode, "Charlie");
  await expect(host.getByText("Charlie")).toBeVisible();

  await host.getByRole("button", { name: "Start game" }).click();
  await submitClue(bob, "blue");
  await submitClue(charlie, "green");
  await bob.getByRole("button", { name: "Reveal valid clues" }).click();

  await host.getByLabel("Your guess").fill("definitely wrong answer");
  await host.getByRole("button", { name: "Submit" }).click();

  await expect(host.getByText("Wrong", { exact: true })).toBeVisible();
  await expect(host.getByText("2/13")).toBeVisible();
  await expect(host.getByLabel("Score 0 out of 13")).toBeVisible();

  await hostContext.close();
  await bobContext.close();
  await charlieContext.close();
});
async function joinRoom(page: import("@playwright/test").Page, roomCode: string, name: string) {
  await page.goto(`/room/${roomCode}`);
  await page.getByLabel("Display name").fill(name);
  await page.getByTitle("Join room").click();
  await expect(page.getByText(name)).toBeVisible();
}

async function submitClue(page: import("@playwright/test").Page, clue: string) {
  await expect(page.getByLabel("Your one-word clue")).toBeVisible();
  await page.getByLabel("Your one-word clue").fill(clue);
  await page.getByRole("button", { name: "Send clue" }).click();
}






