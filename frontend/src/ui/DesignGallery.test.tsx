import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { DesignGallery } from "./DesignGallery";

test("the design gallery documents every token and component family", () => {
  render(<DesignGallery />);
  for (const section of ["Colour tokens", "Typography", "Controls", "Fields", "Signals", "Readouts", "Panels"]) {
    expect(screen.getByRole("heading", { name: section })).toBeInTheDocument();
  }
  for (const token of ["--tm-void", "--tm-primary", "--tm-ai", "--tm-warn", "--tm-danger", "--tm-ok"]) {
    expect(screen.getByText(token)).toBeInTheDocument();
  }
});
