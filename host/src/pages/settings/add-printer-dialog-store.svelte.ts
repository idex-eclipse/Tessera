let openState = $state(false);

export function openAddPrinter(): void {
  openState = true;
}

export function closeAddPrinter(): void {
  openState = false;
}

export function isAddPrinterOpen(): boolean {
  return openState;
}