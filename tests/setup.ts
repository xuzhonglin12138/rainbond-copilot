import "@testing-library/jest-dom";

// Mock scrollIntoView for tests
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
});
