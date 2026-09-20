import { type Locator, type Page } from "@playwright/test";
import { ROUTES } from "../helpers/user";

export class SlotsPage {
  readonly dateInput: Locator;
  readonly timeInput: Locator;
  readonly addButton: Locator;
  readonly cards: Locator;

  constructor(readonly page: Page) {
    this.dateInput = page.getByLabel("Дата", { exact: true });
    this.timeInput = page.getByLabel("Время начала", { exact: true });
    this.addButton = page.getByRole("button", { name: "Добавить слот", exact: true });
    this.cards = page.locator("[data-slot-id]");
  }

  async goto(): Promise<void> {
    await this.page.goto(ROUTES.slots);
  }

  getSlot(time: string): Locator {
    return this.cards.filter({ hasText: time });
  }

  getDeleteButton(time: string): Locator {
    return this.getSlot(time).getByRole("button", { name: "Удалить", exact: true });
  }

  async addSlot(date: string, time: string): Promise<void> {
    await this.dateInput.fill(date);
    await this.timeInput.fill(time);
    await this.addButton.click();
  }

  async isDateBeforeMinimum(): Promise<boolean> {
    return this.dateInput.evaluate((input) =>
      (input as unknown as { validity: { rangeUnderflow: boolean } }).validity.rangeUnderflow,
    );
  }

  async deleteSlot(time: string): Promise<void> {
    const deleted = this.page.waitForResponse((response) =>
      new URL(response.url()).pathname === ROUTES.slots && response.request().method() === "POST",
    );
    await this.getDeleteButton(time).click();
    await deleted;
  }
}
