import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { makeUser, registerUserViaApi, cleanupUsersViaApi, ROUTES, type TestUser } from "../helpers/user";
import { contextOptions } from "../helpers/browser-context";
import { BookingPage } from "../pages/booking-page";
import { ProfilePage } from "../pages/profile-page";

test.use({ contextOptions, storageState: { cookies: [], origins: [] } });

test.describe("Незарегистрированный пользователь", () => {
  let contexts: BrowserContext[] = [];
  let host: TestUser;
  let skillTag: string;
  let visitorBookingPage: BookingPage;
  let hostBookingPage: BookingPage;

  test.beforeEach(async ({ browser, page, baseURL }) => {
    const runId = randomUUID();
    host = makeUser("host", runId);
    skillTag = `Unregistered-${runId}`;
    visitorBookingPage = new BookingPage(page);

    // Авторизация ведущего не попадает в отдельный контекст посетителя.
    const hostContext = await browser.newContext({ ...contextOptions, baseURL });
    contexts.push(hostContext);
    const hostPage = await hostContext.newPage();
    const hostProfilePage = new ProfilePage(hostPage);
    hostBookingPage = new BookingPage(hostPage);

    await test.step("Подготовка: создаём ведущего и добавляем навык", async () => {
      await registerUserViaApi(hostContext.request, host);
      await hostProfilePage.goto();
      await hostProfilePage.addSkill(skillTag, "can_help");
    });

    await test.step("Навык ведущего сохранён", async () => {
      await expect(hostProfilePage.canHelpSkills).toContainText(skillTag);
    });

    await test.step("Подготовка: ведущий добавляет слот на завтра", async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await hostBookingPage.addSlot(tomorrow.toISOString().slice(0, 10), "12:00");
    });

    await test.step("Свободный слот создан", async () => {
      await expect(hostBookingPage.slotsCard).toHaveCount(1);
    });

    await test.step("Посетитель без регистрации открывает каталог", async () => {
      await page.goto(ROUTES.home);
    });
  });

  test.afterEach(async () => {
    const createdContexts = contexts;
    contexts = [];
    await cleanupUsersViaApi(createdContexts);
  });

  test("Посетитель может просматривать каталог и страницу участника со свободными слотами", async () => {
    await test.step("Посетитель ищет ведущего по навыку", async () => {
      await visitorBookingPage.searchBySkill(skillTag);
    });

    await test.step("В каталоге видна карточка ведущего с его навыком", async () => {
      await expect(visitorBookingPage.getHostCard(host.name)).toBeVisible();
      await expect(visitorBookingPage.getHostCard(host.name)).toContainText(skillTag);
    });

    await test.step("Посетитель открывает страницу ведущего", async () => {
      await visitorBookingPage.openHostCard(host.name);
    });

    await test.step("Без авторизации доступны имя участника и календарь", async () => {
      await expect(visitorBookingPage.personName).toHaveText(host.name);
      await expect(visitorBookingPage.bookingCalendarDay).toHaveCount(1);
    });

    await test.step("Посетитель выбирает день", async () => {
      await visitorBookingPage.bookingCalendarDay.click();
    });

    await test.step("Свободное время отображается", async () => {
      await expect(visitorBookingPage.bookingCalendarTime).toHaveText(["12:00"]);
    });
  });

  test("при попытке бронирования предлагается авторизоваться", async ({ page }) => {
    await test.step("Посетитель находит ведущего и открывает его страницу", async () => {
      await visitorBookingPage.searchBySkill(skillTag);
      await visitorBookingPage.openHostCard(host.name);
    });

    await test.step("Страница ведущего загружена", async () => {
      await expect(visitorBookingPage.personName).toHaveText(host.name);
      await expect(visitorBookingPage.bookingCalendarDay).toBeVisible();
    });

    await test.step("Посетитель выбирает свободный слот", async () => {
      await visitorBookingPage.selectFirstAvailableSlot();
    });

    await test.step("Открыт диалог подтверждения бронирования", async () => {
      await expect(visitorBookingPage.bookingConfirmDialog).toBeVisible();
    });

    await test.step("Посетитель пытается подтвердить бронирование", async () => {
      await visitorBookingPage.bookingConfirmButton.click();
    });

    await test.step("Вместо бронирования показано предложение войти в аккаунт", async () => {
      await expect(visitorBookingPage.bookingConfirmError).toHaveText("Нужно войти в аккаунт PomidorQA");
      await expect(visitorBookingPage.bookingConfirmSuccess).not.toBeVisible();
    });

    await test.step("Ведущий открывает свои встречи", async () => {
      await hostBookingPage.gotoMeetings();
    });

    await test.step("Попытка без авторизации не создала встречу", async () => {
      await expect(hostBookingPage.bookingsUpcomingSection).toContainText("Пока пусто");
    });

    await test.step("Посетитель снова открывает календарь ведущего", async () => {
      await page.goto(ROUTES.home);
      await visitorBookingPage.searchBySkill(skillTag);
      await visitorBookingPage.openHostCard(host.name);
      await visitorBookingPage.bookingCalendarDay.click();
    });

    await test.step("Слот остался доступен для бронирования", async () => {
      await expect(visitorBookingPage.bookingCalendarTime).toHaveText(["12:00"]);
    });
  });
});
