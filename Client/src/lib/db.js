import { supabase } from "./supabase";

export class StatusError extends Error {}

export async function callRpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new StatusError(error.message);
  return data;
}

export async function fetchTable(table, select, options = {}) {
  let query = supabase.from(table).select(select);
  if (options.eq) for (const [col, val] of Object.entries(options.eq)) query = query.eq(col, val);
  if (options.order) query = query.order(options.order.col, { ascending: options.order.asc ?? true });
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function insertRow(table, payload) {
  const { data, error } = await supabase.from(table).insert(payload).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateRow(table, eq, payload) {
  let query = supabase.from(table).update(payload);
  for (const [col, val] of Object.entries(eq)) query = query.eq(col, val);
  const { data, error } = await query.select();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteRow(table, eq) {
  let query = supabase.from(table).delete();
  for (const [col, val] of Object.entries(eq)) query = query.eq(col, val);
  const { error } = await query;
  if (error) throw new Error(error.message);
}
