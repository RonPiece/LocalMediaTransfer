using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

namespace LocalMediaTransfer.GUI.AppServices
{
    internal enum EnqueueResult { Added, Duplicate, Full }

    // Used on the UI dispatcher. Active keys remain reserved until Complete.
    internal sealed class BoundedRequestQueue<T>
    {
        private readonly Queue<T> _items = new();
        private readonly HashSet<string> _keys = new(StringComparer.Ordinal);
        private readonly Func<T, string> _key;
        private readonly int _capacity;

        public BoundedRequestQueue(int capacity, Func<T, string> key)
        {
            if (capacity <= 0) throw new ArgumentOutOfRangeException(nameof(capacity));
            _capacity = capacity;
            _key = key;
        }

        public int Count => _items.Count;

        public EnqueueResult TryAdd(T item)
        {
            string key = _key(item);
            if (_keys.Contains(key)) return EnqueueResult.Duplicate;
            if (_keys.Count >= _capacity) return EnqueueResult.Full;
            _keys.Add(key);
            _items.Enqueue(item);
            return EnqueueResult.Added;
        }

        public bool TryTake([MaybeNullWhen(false)] out T item) =>
            _items.TryDequeue(out item);

        public void Requeue(T item) => _items.Enqueue(item);

        public void Complete(T item) => _keys.Remove(_key(item));
    }
}
