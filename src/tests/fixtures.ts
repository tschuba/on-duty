export function makePerson(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1", firstName: "Anna", lastName: "Bauer",
    street: "Musterweg", houseNumber: "5", zip: "12345", city: "Musterstadt",
    gender: "female", birthDate: "1985-05-01", phone: "0123", email: "a@b.de",
    ...overrides,
  };
}
