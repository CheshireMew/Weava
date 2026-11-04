export class ApiClientError extends Error {
  constructor(message:string, public status:number, public details?:unknown, public retryAfter?:number) { super(message); }
}
