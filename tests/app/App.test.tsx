import { render, screen } from "@testing-library/react";
import App from "../../src/App";

it("renders the Rainbond Copilot drawer shell", () => {
  render(<App />);
  expect(screen.getAllByText("Rainbond Copilot").length).toBeGreaterThan(0);
});
