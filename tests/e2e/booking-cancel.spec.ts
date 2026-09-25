import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { makeUser, registerUserViaApi, cleanupUsersViaApi, ROUTES } from "../helpers/user";
import { contextOptions } from "../helpers/browser-context";
import { BookingPage } from "../pages/booking-page";
import { ProfilePage } from "../pages/profile-page";


let contexts: BrowserContext[] = [];

test.afterEach(async () => {
  const createdContexts = contexts;
  contexts = [];
  await cleanupUsersViaApi(createdContexts);
});

test.describe("Бронирование и отмена встречи", () => {
    test("{Хост добавляет слот -> Гость бронирует слот -> Гость отменяет встречу -> Карточка переходит в прошедшие", async ({

    browser,
    baseURL,
    }) => {
        const runId = `${Date.now()}-${randomUUID()}`;
        const skillTag = `Playwright-demo-${runId}`;
        const host = makeUser("host", runId);
        const guest = makeUser("guest", runId);

        // Два независимых аккаунта = два независимых браузерных контекста
        const hostContext = await browser.newContext({ ...contextOptions, baseURL });
        contexts.push(hostContext);
        const guestContext = await browser.newContext({ ...contextOptions, baseURL });
        contexts.push(guestContext);
        const hostPage = await hostContext.newPage();
        const guestPage = await guestContext.newPage();

        // экземпляры страниц
        const hostProfilePage = new ProfilePage(hostPage);
        const hostBookingPage = new BookingPage(hostPage);
        const guestBookingPage = new BookingPage(guestPage);


  await test.step("Хост: создаётся через API", async () => {
    await registerUserViaApi(hostContext.request, host);
    await hostPage.goto(ROUTES.home);
  });
 
  await test.step('Хост: добавляет навык «могу помочь» в профиле', async () => {
      await hostProfilePage.goto();
      await hostProfilePage.addSkill(skillTag, 'can_help');
  });

  await test.step('Навык «могу помочь» отображается', async () => {
      await expect(hostProfilePage.canHelpSkills).toContainText(skillTag);
    });

  await test.step('Хост: добавляет свободный слот на завтра', async () => {

      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const date = tomorrow.toISOString().slice(0, 10);

      await hostBookingPage.addSlot(date, '12:00');
    });

  await test.step('Добавленный слот отображается', async () => {
      await expect(hostBookingPage.slotsCard.first()).toBeVisible();
    });

  await test.step("Гость: создаётся через API", async () => {
    await registerUserViaApi(guestContext.request, guest);
    await guestPage.goto(ROUTES.home);
  });

  await test.step('Гость: ищет хоста в каталоге по навыку (сценарий 9)', async () => {
      await guestPage.goto(ROUTES.home);
      await guestBookingPage.searchBySkill(skillTag);
    });

  await test.step('У навыка указано имя владельца - хост', async () => {
      await expect(
      guestBookingPage.catalogCard.filter({ hasText: host.name })).toBeVisible();
  });

  await test.step('Гость: открывает карточку хоста', async () => {
      await guestBookingPage.openHostCard(host.name);
    });

    await test.step('В карточке отображается имя хоста', async () => {
      await expect(guestBookingPage.personName).toHaveText(host.name);
    });

  await test.step('Гость: кликает по дню и времени в календаре слотов', async () => {
      await guestBookingPage.waitForFirstAvailableDay();
      await guestBookingPage.selectFirstAvailableSlot();
    });

    await test.step('Диалог подтверждения отображается', async () => {
      await expect(guestBookingPage.bookingConfirmDialog).toBeVisible();
    });

     await test.step('Гость нажимает кнопку подтверждения бронирования', async () => {
      await guestBookingPage.bookingConfirmButton.click();
    });

    await test.step('Бронирование успешно', async () => {
      const success = guestBookingPage.bookingConfirmSuccess;
      const error = guestBookingPage.bookingConfirmError;

      await expect(success.or(error)).toBeVisible({ timeout: 15_000 });

      if (await error.isVisible().catch(() => false)) {
        throw new Error(`Бронирование не удалось: ${await error.textContent()}`);
      }
    });

    await test.step('Гость: отменяет бронирование', async () => {
      await guestBookingPage.gotoMeetings();
      await guestBookingPage.cancelMeeting(host.name);
      await guestBookingPage.page.reload();
    });

    await test.step('Бронирование отменено', async () => {
      await expect(guestBookingPage.bookingsUpcomingSection).toContainText("Пока пусто");
      await expect(guestBookingPage.getPastMeetingCard(host.name), ).toBeVisible();
    });

    await test.step('Хост: обновляет страницу и видит отмену бронирования', async () => {
      await hostBookingPage.gotoMeetings();
      await expect(hostBookingPage.getPastMeetingCard(guest.name), ).toBeVisible();
    });
  });

  test("Хост добавляет слот → гость бронирует → хост отменяет встречу", async ({ browser, baseURL }) => {
    const runId = randomUUID();
    const host = makeUser("host", runId);
    const guest = makeUser("guest", runId);
    const skillTag = `Host-cancel-${runId}`;
    const hostContext = await browser.newContext({ ...contextOptions, baseURL });
    contexts.push(hostContext);
    const guestContext = await browser.newContext({ ...contextOptions, baseURL });
    contexts.push(guestContext);
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();
    const hostProfilePage = new ProfilePage(hostPage);
    const hostBookingPage = new BookingPage(hostPage);
    const guestBookingPage = new BookingPage(guestPage);

    await test.step("Создаём участников через API и открываем профиль хоста", async () => {
      await registerUserViaApi(hostContext.request, host);
      await registerUserViaApi(guestContext.request, guest);
      await hostProfilePage.goto();
    });

    await test.step("Хост добавляет навык для поиска в каталоге", async () => {
      await hostProfilePage.addSkill(skillTag, "can_help");
    });

    await test.step("Навык сохранён", async () => {
      await expect(hostProfilePage.canHelpSkills).toContainText(skillTag);
    });

    await test.step("Хост добавляет слот на завтра", async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await hostBookingPage.addSlot(tomorrow.toISOString().slice(0, 10), "12:00");
    });

    await test.step("Слот создан", async () => {
      await expect(hostBookingPage.slotsCard).toHaveCount(1);
    });

    await test.step("Гость находит хоста в каталоге", async () => {
      await guestPage.goto(ROUTES.home);
      await guestBookingPage.searchBySkill(skillTag);
    });

    await test.step("Карточка хоста доступна", async () => {
      await expect(guestBookingPage.getHostCard(host.name)).toBeVisible();
    });

    await test.step("Гость открывает страницу хоста", async () => {
      await guestBookingPage.openHostCard(host.name);
    });

    await test.step("Страница хоста и свободный день отображаются", async () => {
      await expect(guestBookingPage.personName).toHaveText(host.name);
      await expect(guestBookingPage.bookingCalendarDay).toBeVisible();
    });

    const personUrl = guestPage.url();

    await test.step("Гость выбирает слот и подтверждает бронирование", async () => {
      await guestBookingPage.selectFirstAvailableSlot();
      await guestBookingPage.bookingConfirmButton.click();
    });

    await test.step("Бронирование успешно", async () => {
      await expect(guestBookingPage.bookingConfirmSuccess).toBeVisible({ timeout: 15_000 });
      await expect(guestBookingPage.bookingConfirmError).not.toBeVisible();
    });

    await test.step("Оба участника открывают свои встречи", async () => {
      await hostBookingPage.gotoMeetings();
      await guestBookingPage.gotoMeetings();
    });

    await test.step("До отмены встреча есть у обоих участников в ближайших", async () => {
      await expect(hostBookingPage.getMeetingCard(guest.name)).toBeVisible();
      await expect(guestBookingPage.getMeetingCard(host.name)).toBeVisible();
    });

    await test.step("Хост отменяет бронирование, оба участника обновляют страницы", async () => {
      await hostBookingPage.cancelMeeting(guest.name);
      await hostPage.reload();
      await guestPage.reload();
    });

    await test.step("У обоих участников встреча переместилась из ближайших в прошедшие и отменённые", async () => {
      await expect(hostBookingPage.getMeetingCard(guest.name)).toHaveCount(0);
      await expect(guestBookingPage.getMeetingCard(host.name)).toHaveCount(0);
      await expect(hostBookingPage.getPastMeetingCard(guest.name)).toBeVisible();
      await expect(guestBookingPage.getPastMeetingCard(host.name)).toBeVisible();
    });

    await test.step("Гость снова открывает календарь хоста", async () => {
      await guestPage.goto(personUrl);
      await guestBookingPage.bookingCalendarDay.click();
    });

    await test.step("После отмены слот снова доступен", async () => {
      await expect(guestBookingPage.bookingCalendarTime).toHaveText(["12:00"]);
    });
  });
});
