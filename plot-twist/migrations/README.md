# Plot Twist Database Migrations

This directory contains SQL migrations for the Plot Twist game database.

## Migrations

1. `01_create_players_table.sql` - Creates the `players` table with stable seat numbers.
2. `02_create_seat_assignment_function.sql` - Creates a function to safely assign seat numbers to players.

## How to Run

These migrations should be run against your Supabase database in the following order:

1. First, apply the table creation: `01_create_players_table.sql`
2. Then, apply the function creation: `02_create_seat_assignment_function.sql`

You can run these migrations through the Supabase SQL Editor or via the Supabase CLI.

## Purpose

These migrations implement stable player ordering through persistent seat numbers, 
which solves the problem of player reordering when reconnects happen or when host changes occur.

The key improvements are:

1. Each player gets a unique, immutable seat number per room
2. Seat numbers are only assigned once when a player first joins
3. The system uses a single atomic `INSERT ... ON CONFLICT DO NOTHING` to prevent race conditions
4. Sorting is now based on seat numbers rather than timestamps, ensuring stable order 