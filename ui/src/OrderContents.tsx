// ui/src/OrderContents.tsx
// What was ordered, and where it came in from. Two questions in one block because a
// visitor asks them together: an opened card used to show five checkpoints and say
// nothing at all about the order they were carrying.
//
// Order mail appears here as an origin rather than as a sixth checkpoint. It is one
// of the two ways an order gets in (spec 4), not a system an order is delivered to.
// A checkpoint for it would claim a delivery that never happens and would leave one
// box of six permanently unreachable for every order placed on the shop page.
import type { OrderBooking } from '@ngl/contracts';

const ORIGINS: Record<OrderBooking['source'], string> = {
  form: 'Came in from the shop page',
  email: 'Read out of an order mail',
};

/**
 * An event can reach the queue with no orders row behind it, a Stripe payment
 * webhook being the one that does it today. Saying so is better than an empty box,
 * and much better than a card that cannot be opened.
 */
const NO_BASKET = 'No basket was written down for this one, so there is nothing to itemise.';

function money(cents: number): string {
  return `${(cents / 100).toFixed(2)} EUR`;
}

export function OrderContents(props: {
  eventId: string;
  booking: OrderBooking | null;
}) {
  const { booking, eventId } = props;

  return (
    <div className="order-contents">
      <p className="order-origin" data-testid={`order-origin-${eventId}`}>
        {booking ? ORIGINS[booking.source] : NO_BASKET}
      </p>

      {booking && booking.lines.length > 0 && (
        <ul className="order-basket" data-testid={`order-basket-${eventId}`}>
          {booking.lines.map((line) => (
            <li key={line.sku}>
              <span className="order-line">{line.qty} x {line.name}</span>
              <span className="order-money">{money(line.cents)}</span>
            </li>
          ))}
        </ul>
      )}

      {booking && (
        <p className="order-total" data-testid={`order-total-${eventId}`}>
          {/* The figure Stripe was charged, read back rather than re-added, so a
              visitor holding the receipt next to the card finds the same number. */}
          <span className="order-line">Total</span>
          <span className="order-money">{money(booking.totalCents)}</span>
        </p>
      )}
    </div>
  );
}
