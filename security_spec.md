# Security Specification

## Data Invariants
1. Products must belong to a specific user (ownerId).
2. Users can only read and write their own products and settings.
3. Every product must have a valid name and total cost.
4. Settings must include valid commission values (percentages between 0 and 100).
5. Timestamps must be validated against request.time if implemented (though current schema uses strings, future updates should use server timestamps).

## The Dirty Dozen Payloads (Rejection Targets)
1. Write a product to another user's path.
2. Read settings of another user.
3. Create a product with a missing `ownerId`.
4. Create a product where `ownerId` does not match `request.auth.uid`.
5. Update `ownerId` of an existing product.
6. Inject a 2MB string into the product name.
7. Set a delivery commission to 150%.
8. Delete a product that belongs to another user.
9. List all products from the root (shadow read).
10. Create a product with a malicious document ID (1KB string).
11. Update a product's cost to a negative number.
12. Modify a product without being authenticated.

## The Test Plan
Verify that all "Dirty Dozen" scenarios return `PERMISSION_DENIED` using local testing or simulation (rules logic).
