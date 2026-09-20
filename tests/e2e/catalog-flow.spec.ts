import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { makeUser, registerUserViaApi, cleanupUsersViaApi, ROUTES, type TestUser } from "../helpers/user";
import { contextOptions } from "../helpers/browser-context";
import { BookingPage } from "../pages/booking-page";
import { SlotsPage } from "../pages/slots-page";
import { ProfilePage } from "../pages/profile-page";

type Participant = {
  user: TestUser;
  page: Page;
  booking: BookingPage;
  slots: SlotsPage;
};

test.use({ contextOptions, storageState: { cookies: [], origins: [] } });

test.describe("Каталог участников", () => {
  // Один тест дожидается реального начала слота: часы браузера не меняют время сервера.
  test.setTimeout(180_000);
  let contexts: BrowserContext[] = [];
  let participants: Participant[];
  let skillTag: string;
  let tomorrow: string;

  test.beforeEach(async ({ browser, baseURL }) => {
    participants = [];
    const runId = randomUUID();
    skillTag = `Catalog-${runId}`;
    tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    for (const role of ["host", "future", "no-slots"]) {
      const user = makeUser(role, runId);
      const context = await browser.newContext({ ...contextOptions, baseURL });
      contexts.push(context);
      const page = await context.newPage();
      const profile = new ProfilePage(page);
      participants.push({ user, page, booking: new BookingPage(page), slots: new SlotsPage(page) });

      await test.step(`${role}: создаём аккаунт и добавляем общий навык`, async () => {
        await registerUserViaApi(context.request, user);
        await profile.goto();
        await profile.addSkill(skillTag, "can_help");
      });
      await test.step(`${role}: навык сохранён`, async () => {
        await expect(profile.canHelpSkills).toContainText(skillTag);
      });
    }

    const future = participants[1];
    await test.step("Контрольный участник добавляет слот на завтра", async () => {
      await future.slots.goto();
      await future.slots.addSlot(tomorrow, "12:00");
    });
    await test.step("Контрольный слот создан и свободен", async () => {
      await expect(future.slots.cards).toHaveCount(1);
      await expect(future.slots.getSlot("12:00")).toContainText("свободен");
    });
  });

  test.afterEach(async () => {
    const createdContexts = contexts;
    contexts = [];
    await cleanupUsersViaApi(createdContexts);
  });

  test("в каталоге только участники с будущими слотами: без слотов и с прошедшим слотом скрыты", async ({ page }) => {
    const [host, future, withoutSlots] = participants;
    const catalog = new BookingPage(page);
    // Округляем до минуты вверх, оставляя минимум 45 секунд на создание и первую проверку.
    const startsAt = Math.ceil((Date.now() + 45_000) / 60_000) * 60_000;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(startsAt));
    const part = (type: string) => parts.find((value) => value.type === type)!.value;
    const date = `${part("year")}-${part("month")}-${part("day")}`;
    const time = `${part("hour")}:${part("minute")}`;

    await test.step("Хост добавляет слот с началом в ближайшие две минуты", async () => {
      await host.slots.goto();
      await host.slots.addSlot(date, time);
    });
    await test.step("У хоста ровно один свободный слот", async () => {
      await expect(host.slots.cards).toHaveCount(1);
      await expect(host.slots.getSlot(time)).toContainText("свободен");
    });
    await test.step("Посетитель открывает каталог и ищет участников по общему навыку", async () => {
      await page.goto(ROUTES.home);
      await catalog.searchBySkill(skillTag);
    });
    await test.step("Видны оба участника с будущими слотами, участника без слотов нет", async () => {
      await expect(catalog.getHostCard(host.user.name)).toBeVisible();
      await expect(catalog.getHostCard(future.user.name)).toBeVisible();
      await expect(catalog.catalogCard).toHaveCount(2);
      await expect(catalog.getHostCard(withoutSlots.user.name)).toHaveCount(0);
      expect(Date.now()).toBeLessThan(startsAt);
    });

    await test.step("Дожидаемся, когда время начала слота останется в прошлом", async () => {
      await expect.poll(() => Date.now(), {
        timeout: 110_000, intervals: [1_000],
      }).toBeGreaterThan(startsAt + 2_000);
    });
    await test.step("Заново загружаем каталог с тем же фильтром", async () => {
      await page.reload();
    });
    await test.step("Остался только участник со слотом на завтра", async () => {
      await expect(catalog.catalogFilterInput).toHaveValue(skillTag);
      await expect(catalog.getHostCard(future.user.name)).toBeVisible();
      await expect(catalog.catalogCard).toHaveCount(1);
      await expect(catalog.getHostCard(host.user.name)).toHaveCount(0);
      await expect(catalog.getHostCard(withoutSlots.user.name)).toHaveCount(0);
    });
  });

  test("участник не видит собственную карточку со слотом, но видит чужую", async () => {
    const [host, other] = participants;

    await test.step("Хост добавляет свой слот на завтра", async () => {
      await host.slots.goto();
      await host.slots.addSlot(tomorrow, "14:00");
    });
    await test.step("Собственный слот создан и свободен", async () => {
      await expect(host.slots.cards).toHaveCount(1);
      await expect(host.slots.getSlot("14:00")).toContainText("свободен");
    });

    for (const [viewer, visible] of [[host, other], [other, host]]) {
      await test.step(`${viewer.user.name}: открывает каталог и ищет по общему навыку`, async () => {
        await viewer.page.goto(ROUTES.home);
        await viewer.booking.searchBySkill(skillTag);
      });
      await test.step(`${viewer.user.name}: видит только другого участника`, async () => {
        await expect(viewer.booking.getHostCard(visible.user.name)).toBeVisible();
        await expect(viewer.booking.catalogCard).toHaveCount(1);
        await expect(viewer.booking.getHostCard(viewer.user.name)).toHaveCount(0);
      });
    }
  });
});
