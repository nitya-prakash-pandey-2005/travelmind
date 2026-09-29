import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { App } from "./App";

test("renders the TravelMind wordmark", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: /travelmind/i })).toBeInTheDocument();
});
