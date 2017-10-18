# FlashStore v0.1.2 Documentation

## Classes

<dl>
<dt><a href="#FlashStore">FlashStore</a></dt>
<dd></dd>
</dl>

## Typedefs

<dl>
<dt><a href="#IteratorOptions">IteratorOptions</a></dt>
<dd></dd>
</dl>

<a name="FlashStore"></a>

## FlashStore
**Kind**: global class  

* [FlashStore](#FlashStore)
    * [new FlashStore([workdir])](#new_FlashStore_new)
    * [.put(key, value)](#FlashStore+put) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.get(key)](#FlashStore+get) ⇒ <code>Promise.&lt;(V\|null)&gt;</code>
    * [.del(key)](#FlashStore+del) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.keys([options])](#FlashStore+keys) ⇒ <code>AsyncIterableIterator.&lt;K&gt;</code>
    * [.values()](#FlashStore+values) ⇒ <code>AsyncIterableIterator.&lt;V&gt;</code>
    * [.count()](#FlashStore+count) ⇒ <code>Promise.&lt;number&gt;</code>
    * [.destroy()](#FlashStore+destroy) ⇒ <code>Promise.&lt;void&gt;</code>

<a name="new_FlashStore_new"></a>

### new FlashStore([workdir])
FlashStore is a Key-Value database tool and makes using leveldb more easy for Node.js

Creates an instance of FlashStore.


| Param | Type | Default |
| --- | --- | --- |
| [workdir] | <code>string</code> | <code>&quot;path.join(appRoot, &#x27;flash-store.workdir&#x27;)&quot;</code> | 

**Example**  
```js
import { FlashStore } from 'flash-store'
const flashStore = new FlashStore('falshstore.workdir')
```
<a name="FlashStore+put"></a>

### flashStore.put(key, value) ⇒ <code>Promise.&lt;void&gt;</code>
Put data in database

**Kind**: instance method of [<code>FlashStore</code>](#FlashStore)  

| Param | Type |
| --- | --- |
| key | <code>K</code> | 
| value | <code>V</code> | 

**Example**  
```js
await flashStore.put(1, 1)
```
<a name="FlashStore+get"></a>

### flashStore.get(key) ⇒ <code>Promise.&lt;(V\|null)&gt;</code>
Get value from database by key

**Kind**: instance method of [<code>FlashStore</code>](#FlashStore)  

| Param | Type |
| --- | --- |
| key | <code>K</code> | 

**Example**  
```js
console.log(await flashStore.get(1))
```
<a name="FlashStore+del"></a>

### flashStore.del(key) ⇒ <code>Promise.&lt;void&gt;</code>
Del data by key

**Kind**: instance method of [<code>FlashStore</code>](#FlashStore)  

| Param | Type |
| --- | --- |
| key | <code>K</code> | 

**Example**  
```js
await flashStore.del(1)
```
<a name="FlashStore+keys"></a>

### flashStore.keys([options]) ⇒ <code>AsyncIterableIterator.&lt;K&gt;</code>
Find keys by IteratorOptions

**Kind**: instance method of [<code>FlashStore</code>](#FlashStore)  

| Param | Type | Default |
| --- | --- | --- |
| [options] | [<code>IteratorOptions</code>](#IteratorOptions) | <code>{}</code> | 

**Example**  
```js
const flashStore = new FlashStore('falshstore.workdir')
for await(const key of flashStore.keys({gte: 1})) {
  console.log(key)
}
```
<a name="FlashStore+values"></a>

### flashStore.values() ⇒ <code>AsyncIterableIterator.&lt;V&gt;</code>
Find all values

**Kind**: instance method of [<code>FlashStore</code>](#FlashStore)  
**Example**  
```js
const flashStore = new FlashStore('falshstore.workdir')
for await(const value of flashStore.values()) {
  console.log(value)
}
```
<a name="FlashStore+count"></a>

### flashStore.count() ⇒ <code>Promise.&lt;number&gt;</code>
Get the counts of the database

**Kind**: instance method of [<code>FlashStore</code>](#FlashStore)  
**Example**  
```js
const count = await flashStore.count()
console.log(`database count: ${count}`)
```
<a name="FlashStore+destroy"></a>

### flashStore.destroy() ⇒ <code>Promise.&lt;void&gt;</code>
Destroy the database

**Kind**: instance method of [<code>FlashStore</code>](#FlashStore)  
<a name="IteratorOptions"></a>

## IteratorOptions
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| gt | <code>any</code> | Matches values that are greater than a specified value |
| gte | <code>any</code> | Matches values that are greater than or equal to a specified value. |
| lt | <code>any</code> | Matches values that are less than a specified value. |
| lte | <code>any</code> | Matches values that are less than or equal to a specified value. |
| reverse | <code>boolean</code> | Reverse the result set |
| limit | <code>number</code> | Limits the number in the result set. |
| prefix | <code>any</code> | Make the same prefix key get together. |

