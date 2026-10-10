// Machine types (docs/DATABASE.md, D3: single-stage production). A product names the machine type
// that makes it, so feasibility can later match orders to machines.
export const MACHINE_TYPES = Object.freeze(['SPINNING', 'WEAVING', 'DYEING', 'FINISHING']);

export const WEAVES = Object.freeze(['PLAIN', 'TWILL', 'SATIN', 'DOBBY']);
