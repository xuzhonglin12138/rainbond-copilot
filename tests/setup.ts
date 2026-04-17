import "@testing-library/jest-dom";

// Mock scrollIntoView for tests
Element.prototype.scrollIntoView = () => {};

afterEach(() => {
  localStorage.clear();
});
