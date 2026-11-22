import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { AskPage } from "../src/pages/AskPage.js";
import { matchRoute } from "../src/router.js";
import { ABOUT_NAME, bodyOf, mockFetch, networkError } from "./helpers.js";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const created = { status: 201, body: { tracking: "/comforce-demo/t/tok" } };

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillValidForm(contact = "414-555-0134") {
  type("What do you need?", "My walk is covered in snow and I cannot get out.");
  type("Your first name", "Rosa");
  type("How can we reach you?", contact);
  type("ZIP code", "53206");
  fireEvent.click(screen.getByRole("radio", { name: "No" }));
}

const send = () => {
  fireEvent.click(screen.getByRole("button", { name: "Send request" }));
};

describe("AskPage sending", () => {
  it("the form shows the tracking link after a send", async () => {
    const calls = mockFetch([created]);
    render(<AskPage org="comforce-demo" />);
    fillValidForm();
    send();
    const link = await screen.findByRole("link", { name: /comforce-demo\/t\/tok/ });
    expect(link.getAttribute("href")).toBe("/comforce-demo/t/tok");
    expect(calls[0]?.url).toBe("/api/v1/o/comforce-demo/requests");
    expect(bodyOf(calls[0] ?? { url: "", init: {} })).toEqual({
      firstName: "Rosa",
      contactKind: "phone",
      contact: "414-555-0134",
      zip: "53206",
      message: "My walk is covered in snow and I cannot get out.",
      address: "",
      safeContact: false,
      website: "",
    });
  });

  it("an email address is sent as an email contact", async () => {
    const calls = mockFetch([created]);
    render(<AskPage org="comforce-demo" />);
    fillValidForm("rosa@example.test");
    send();
    await screen.findByRole("link", { name: /comforce-demo\/t\/tok/ });
    expect(bodyOf(calls[0] ?? { url: "", init: {} })).toMatchObject({ contactKind: "email" });
  });

  it("no connection says it was not sent and keeps the answers", async () => {
    mockFetch([networkError]);
    render(<AskPage org="comforce-demo" />);
    fillValidForm();
    send();
    expect((await screen.findByRole("alert")).textContent).toBe("Not sent. No connection. Try again.");
    expect(screen.getByLabelText<HTMLInputElement>("Your first name").value).toBe("Rosa");
  });
});

describe("AskPage checks", () => {
  it("the ask route opens the form with the 911 line", async () => {
    mockFetch([]);
    render(<App route={matchRoute("/comforce-demo/ask")} />);
    expect(await screen.findByRole("heading", { name: `Ask ${ABOUT_NAME} for help` })).toBeTruthy();
    expect(screen.getByText("Call 911.")).toBeTruthy();
  });
});

describe("AskPage fields", () => {
  it("the trap field is hidden from people and screen readers", () => {
    render(<AskPage org="comforce-demo" />);
    expect(screen.queryByLabelText(/website/i)).toBeNull();
    const trap = document.querySelector('input[name="website"]');
    expect(trap?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(trap?.getAttribute("tabindex")).toBe("-1");
  });

  it("a ZIP code of 4 digits shows a plain error", async () => {
    const calls = mockFetch([]);
    render(<AskPage org="comforce-demo" />);
    fillValidForm();
    type("ZIP code", "5321");
    send();
    expect(await screen.findByText("Type a ZIP code with 5 numbers.")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("the safe question has no default and must be answered", async () => {
    const calls = mockFetch([]);
    render(<AskPage org="comforce-demo" />);
    expect(screen.getAllByRole("radio").some((radio) => (radio as HTMLInputElement).checked)).toBe(false);
    type("What do you need?", "Rides to the clinic");
    type("Your first name", "Rosa");
    type("How can we reach you?", "414-555-0134");
    type("ZIP code", "53206");
    send();
    expect(await screen.findByText("Choose Yes or No.")).toBeTruthy();
    await waitFor(() => {
      expect(calls).toHaveLength(0);
    });
  });
});

function fillSpanishForm() {
  type("¿Qué necesita?", "Tengo setenta y seis años y no puedo palear la nieve.");
  type("Su nombre", "Carmen");
  type("¿Cómo podemos comunicarnos con usted?", "414-555-0171");
  type("Código postal (ZIP)", "53206");
  fireEvent.click(screen.getByRole("radio", { name: "No" }));
}

describe("AskPage language choice", () => {
  it("offers English and Español with nothing chosen, and the page starts in English", () => {
    render(<AskPage org="comforce-demo" />);
    const group = screen.getByRole("radiogroup", { name: "English / Español" });
    expect(group).toBeTruthy();
    expect(screen.getByRole("radio", { name: "English" })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Español" }).checked).toBe(false);
    expect(screen.getByLabelText("What do you need?")).toBeTruthy();
  });

  it("Español shows the ask form in human-written Spanish and sends lang es", async () => {
    const calls = mockFetch([created]);
    render(<AskPage org="comforce-demo" />);
    fireEvent.click(screen.getByRole("radio", { name: "Español" }));
    expect(await screen.findByRole("heading", { name: `Pida ayuda a ${ABOUT_NAME}` })).toBeTruthy();
    expect(screen.getByText("Llame al 911.")).toBeTruthy();
    expect(document.querySelector('[lang="es"]')).not.toBeNull();
    fillSpanishForm();
    fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    expect(await screen.findByRole("heading", { name: "Tenemos su solicitud" })).toBeTruthy();
    expect(screen.getByText(`Una persona de ${ABOUT_NAME} lee cada solicitud.`)).toBeTruthy();
    expect(screen.getByText("Guarde este enlace. Muestra cada paso de su solicitud.")).toBeTruthy();
    expect(bodyOf(calls[0] ?? { url: "", init: {} })).toMatchObject({ lang: "es", firstName: "Carmen" });
  });
});

describe("AskPage language sends", () => {
  it("English chosen by the resident is sent as lang en", async () => {
    const calls = mockFetch([created]);
    render(<AskPage org="comforce-demo" />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    fillValidForm();
    send();
    await screen.findByRole("heading", { name: "We have your request" });
    expect(bodyOf(calls[0] ?? { url: "", init: {} })).toMatchObject({ lang: "en" });
  });

  it("Spanish errors are Spanish too", async () => {
    mockFetch([networkError]);
    render(<AskPage org="comforce-demo" />);
    fireEvent.click(screen.getByRole("radio", { name: "Español" }));
    fillSpanishForm();
    type("Código postal (ZIP)", "5320");
    fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    expect(await screen.findByText("Escriba un código postal de 5 números.")).toBeTruthy();
    type("Código postal (ZIP)", "53206");
    fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "No se envió. No hay conexión. Intente de nuevo.",
    );
  });
});
