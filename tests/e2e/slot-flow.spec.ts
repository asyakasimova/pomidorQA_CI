import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { makeUser, registerUserViaApi, cleanupUsersViaApi, ROUTES, type TestUser } from "../helpers/user";
import { contextOptions } from "../helpers/browser-context";
import { SlotsPage } from "../pages/slots-page";
import { BookingPage } from "../pages/booking-page";
import { ProfilePage } from "../pages/profile-page";

test.use({ contextOptions });

test.describe("Слоты участника", () => {
  let contexts: BrowserContext[] = [];
  let slotsPage: SlotsPage;
  let host: TestUser;
  let tomorrow: string;

  test.beforeEach(async ({ page, context }) => {
    contexts.push(context);
    host = makeUser("slot-host", randomUUID());
    tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    slotsPage = new SlotsPage(page);
    await test.step("Создаём участника через API и открываем «Мои слоты»", async () => {
      await registerUserViaApi(context.request, host);
      await slotsPage.goto();
    });
  });

  test.afterEach(async () => {
    const createdContexts = contexts;
    contexts = [];
    await cleanupUsersViaApi(createdContexts);
  });

  test("добавленный слот отображается на странице слотов после перезагрузки", async ({ page }) => {
    await test.step("Добавляем слот на завтра", async () => {
      await slotsPage.addSlot(tomorrow, "12:00");
    });
    await test.step("Слот появился со статусом «свободен»", async () => {
      await expect(slotsPage.cards).toHaveCount(1);
      await expect(slotsPage.getSlot("12:00")).toContainText("свободен");
    });
    await test.step("Перезагружаем страницу", async () => {
      await page.reload();
    });
    await test.step("Сохранённый слот пришёл с сервера", async () => {
      const expectedDate = new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Europe/Moscow", weekday: "short", day: "numeric", month: "short",
      }).format(new Date(`${tomorrow}T12:00:00+03:00`));
      await expect(page).toHaveURL(new RegExp(`${ROUTES.slots}$`));
      await expect(slotsPage.cards).toHaveCount(1);
      await expect(slotsPage.getSlot("12:00")).toContainText(expectedDate);
      await expect(slotsPage.getSlot("12:00")).toContainText("свободен");
    });
  });

  test("нельзя создать слот в прошлом", async ({ page }) => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await test.step("Пытаемся добавить слот на вчера", async () => {
      await slotsPage.addSlot(yesterday, "12:00");
    });
    await test.step("Валидация даты запрещает отправку формы со слотом в прошлом", async () => {
      await expect.poll(() => slotsPage.isDateBeforeMinimum()).toBe(true);
      await expect(slotsPage.cards).toHaveCount(0);
    });
    await test.step("Перезагружаем страницу", async () => {
      await page.reload();
    });
    await test.step("Слот не был сохранён", async () => {
      await expect(slotsPage.cards).toHaveCount(0);
    });
  });

  test("владелец может удалить свободный слот", async ({ page }) => {
    await test.step("Добавляем свободный слот", async () => {
      await slotsPage.addSlot(tomorrow, "12:00");
    });
    await test.step("Свободный слот доступен для удаления", async () => {
      await expect(slotsPage.getSlot("12:00")).toContainText("свободен");
      await expect(slotsPage.getDeleteButton("12:00")).toBeEnabled();
    });
    await test.step("Удаляем слот", async () => {
      await slotsPage.deleteSlot("12:00");
    });
    await test.step("Слот исчез из списка", async () => {
      await expect(slotsPage.cards).toHaveCount(0);
    });
    await test.step("Перезагружаем страницу", async () => {
      await page.reload();
    });
    await test.step("Удалённый слот не возвращается", async () => {
      await expect(slotsPage.cards).toHaveCount(0);
    });
  });

  test("владелец не может удалить забронированный слот", async ({ browser, page, baseURL }) => {
    const guest = makeUser("slot-guest", randomUUID());
    const skillTag = `Slot-${randomUUID()}`;
    const guestContext = await browser.newContext({ ...contextOptions, baseURL });
    contexts.push(guestContext);
    const guestPage = await guestContext.newPage();
    const guestBookingPage = new BookingPage(guestPage);
    const profilePage = new ProfilePage(page);

    await test.step("Хост добавляет навык, чтобы гость нашёл его в каталоге", async () => {
      await profilePage.goto();
      await profilePage.addSkill(skillTag, "can_help");
    });
    await test.step("Навык сохранён", async () => {
      await expect(profilePage.canHelpSkills).toContainText(skillTag);
    });
    await test.step("Хост добавляет слот", async () => {
      await slotsPage.goto();
      await slotsPage.addSlot(tomorrow, "12:00");
    });
    await test.step("До бронирования слот свободен и доступен для удаления", async () => {
      await expect(slotsPage.getSlot("12:00")).toContainText("свободен");
      await expect(slotsPage.getDeleteButton("12:00")).toBeEnabled();
    });
    await test.step("Создаём гостя через API и открываем страницу хоста", async () => {
      await registerUserViaApi(guestContext.request, guest);
      await guestPage.goto(ROUTES.home);
      await guestBookingPage.searchBySkill(skillTag);
      await guestBookingPage.openHostCard(host.name);
    });
    await test.step("Страница хоста загружена", async () => {
      await expect(guestBookingPage.personName).toHaveText(host.name);
      await expect(guestBookingPage.bookingCalendarDay).toBeVisible();
    });
    await test.step("Гость бронирует слот", async () => {
      await guestBookingPage.selectFirstAvailableSlot();
      await guestBookingPage.bookingConfirmButton.click();
    });
    await test.step("Бронирование подтверждено", async () => {
      await expect(guestBookingPage.bookingConfirmSuccess).toBeVisible({ timeout: 15_000 });
    });
    await test.step("Хост обновляет страницу слотов", async () => {
      await page.reload();
    });
    await test.step("Слот забронирован, удалить его через интерфейс нельзя", async () => {
      await expect(slotsPage.cards).toHaveCount(1);
      await expect(slotsPage.getSlot("12:00")).toContainText(/забронирован/i);
      await expect(slotsPage.getDeleteButton("12:00")).toHaveCount(0);
    });
  });
});
