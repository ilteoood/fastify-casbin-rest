'use strict'

const tap = require('tap')
const test = tap.test
const Fastify = require('fastify')
const sinon = require('sinon')
const fp = require('fastify-plugin')

const plugin = require('../')

function makeStubCasbin () {
  return fp(
    async fastify => {
      fastify.decorate(
        'casbin',
        sinon.stub({
          enforce () {}
        })
      )
    },
    {
      name: 'fastify-casbin'
    }
  )
}

let fastify

tap.beforeEach(async () => {
  fastify = new Fastify()
  await fastify.register(makeStubCasbin())
})

tap.afterEach(async () => {
  try {
    await fastify.close()
  } catch (error) {
    tap.error(error)
  }
})

test('throws if no casbin decorator exists', async t => {
  t.plan(1)
  try {
    const buggyFastify = new Fastify()
    await buggyFastify.register(plugin)
  } catch (err) {
    t.equal(err.message, "The decorator 'casbin' required by 'fastify-casbin-rest' is not present in Fastify")
  }
})

test('throws if fastify-casbin plugin is not registered', async t => {
  t.plan(1)
  try {
    const buggyFastify = new Fastify()
    buggyFastify.decorate('casbin', sinon.stub())
    await buggyFastify.register(plugin)
  } catch (err) {
    t.equal(err.message, "The dependency 'fastify-casbin' of plugin 'fastify-casbin-rest' is not registered")
  }
})

test('registration succeeds if fastify-casbin providing a casbin decorator exists', async () => {
  const workingFastify = new Fastify()
  await workingFastify.register(makeStubCasbin())
  await workingFastify.register(plugin)
  await workingFastify.ready()
  await workingFastify.close()
})

test('ignores routes where plugin is not enabled', async t => {
  await fastify.register(plugin)

  fastify.get('/no-options', () => 'ok')
  fastify.get('/no-casbin-rest', { casbin: {} }, () => 'ok')
  fastify.get('/false-casbin-rest', { casbin: { rest: false } }, () => 'ok')

  await fastify.ready()

  t.equal((await fastify.inject('/no-options')).body, 'ok')
  t.equal((await fastify.inject('/no-casbin-rest')).body, 'ok')
  t.equal((await fastify.inject('/false-casbin-rest')).body, 'ok')

  t.notOk(fastify.casbin.enforce.called)
})

test('allows route where plugin is enabled and enforce resolves true', async t => {
  await fastify.register(plugin)

  fastify.get('/', { casbin: { rest: true } }, () => 'ok')

  fastify.casbin.enforce.resolves(true)
  await fastify.ready()

  t.equal((await fastify.inject('/')).body, 'ok')
  t.ok(fastify.casbin.enforce.called)

  const [sub, obj, act] = fastify.casbin.enforce.getCall(0).args
  t.equal(sub, undefined)
  t.equal(obj, '/')
  t.equal(act, 'GET')
})

test('allows route where plugin is enabled and enforce resolves true with dom resolver enabled', async t => {
  await fastify.register(plugin)

  fastify.get('/', { casbin: { rest: { getDom: 'domain' } } }, () => 'ok')

  fastify.casbin.enforce.resolves(true)
  await fastify.ready()

  t.equal((await fastify.inject('/')).body, 'ok')
  t.ok(fastify.casbin.enforce.called)

  const [sub, dom, obj, act] = fastify.casbin.enforce.getCall(0).args
  t.equal(sub, undefined)
  t.equal(dom, 'domain')
  t.equal(obj, '/')
  t.equal(act, 'GET')
})

test('invokes onAllow callback if defined', async t => {
  const onAllow = sinon.spy()
  await fastify.register(plugin, { onAllow })

  fastify.get('/', { casbin: { rest: true } }, () => 'ok')

  fastify.casbin.enforce.resolves(true)
  await fastify.ready()

  t.equal((await fastify.inject('/')).body, 'ok')

  t.ok(onAllow.called)
  const [reply, argsFromCallback] = onAllow.getCall(0).args
  t.ok(reply)
  t.equal(argsFromCallback.sub, undefined)
  t.equal(argsFromCallback.obj, '/')
  t.equal(argsFromCallback.act, 'GET')

  t.ok(fastify.casbin.enforce.called)
  const [sub, obj, act] = fastify.casbin.enforce.getCall(0).args
  t.equal(sub, undefined)
  t.equal(obj, '/')
  t.equal(act, 'GET')
})

test('forbids route where plugin is enabled and enforce resolves false', async t => {
  await fastify.register(plugin)

  fastify.get('/', { casbin: { rest: true } }, () => 'ok')

  fastify.casbin.enforce.resolves(false)
  await fastify.ready()

  t.equal((await fastify.inject('/')).statusCode, 403)
  t.ok(fastify.casbin.enforce.called)
})

test('forbids route where plugin is enabled and enforce resolves false with dom resolver enabled', async t => {
  await fastify.register(plugin, { getDom: () => 'domain' })

  fastify.get('/', { casbin: { rest: true } }, () => 'ok')

  fastify.casbin.enforce.resolves(false)
  await fastify.ready()

  t.equal((await fastify.inject('/')).statusCode, 403)
  t.ok(fastify.casbin.enforce.called)
})

test('works correctly if there is an existing preHandler hook', async t => {
  await fastify.register(plugin)

  const preHandler = sinon.spy((req, reply, done) => done())
  fastify.get('/', { preHandler, casbin: { rest: true } }, () => 'ok')

  fastify.casbin.enforce.resolves(false)
  await fastify.ready()

  t.equal((await fastify.inject('/')).statusCode, 403)
  t.ok(fastify.casbin.enforce.called)
  t.ok(preHandler.calledOnce)
})

test('supports specifying custom hooks', async t => {
  await fastify.register(plugin, { hook: 'onRequest' })

  const preParsing = sinon.spy((req, reply, done) => done())
  fastify.get('/', { preParsing, casbin: { rest: true } }, () => 'ok')

  fastify.casbin.enforce.resolves(false)
  await fastify.ready()

  t.equal((await fastify.inject('/')).statusCode, 403)

  t.ok(fastify.casbin.enforce.called)
  t.notOk(preParsing.called)
})

test('supports specifying custom logger', async t => {
  const log = sinon.spy()
  const getSub = sinon.spy((_request) => 'custom sub')
  const getObj = sinon.spy((_request) => 'custom obj')
  const getAct = sinon.spy((_request) => 'custom act')
  await fastify.register(plugin, { log, getSub, getObj, getAct })

  fastify.get('/', { casbin: { rest: true } }, () => 'ok')
  fastify.casbin.enforce.resolves(true)
  await fastify.ready()

  t.equal((await fastify.inject('/')).statusCode, 200)

  t.ok(log.called)
  const [_fastify, _request, argsFromCallback] = log.getCall(0).args
  t.ok(_fastify)
  t.ok(_request)

  t.ok(getSub.called)
  t.equal(argsFromCallback.sub, 'custom sub')

  t.ok(getObj.called)
  t.equal(argsFromCallback.obj, 'custom obj')

  t.ok(getAct.called)
  t.equal(argsFromCallback.act, 'custom act')
})

test('supports overriding plugin rules on route level', async t => {
  await fastify.register(plugin, {
    hook: 'onRequest',
    getSub: request => request.user,
    getObj: request => request.url,
    getAct: request => request.method
  })
  fastify.get('/', {
    casbin: {
      rest: {
        getSub: request => request.method,
        getObj: request => request.user,
        getAct: request => request.url
      }
    }
  }, () => 'ok')
  fastify.casbin.enforce.resolves(false)
  await fastify.ready()

  await fastify.inject('/')

  t.ok(fastify.casbin.enforce.called)
  const [sub, obj, act] = fastify.casbin.enforce.getCall(0).args
  t.equal(sub, 'GET')
  t.equal(obj, undefined)
  t.equal(act, '/')
})

test('supports passing constants as extractor params without domain', async t => {
  await fastify.register(plugin, {
    hook: 'onRequest',
    getSub: request => request.user,
    getObj: request => request.url,
    getAct: request => request.method
  })
  fastify.get('/', {
    casbin: {
      rest: {
        getSub: 'a',
        getObj: 'b',
        getAct: 'c'
      }
    }
  }, () => 'ok')
  fastify.casbin.enforce.resolves(false)
  await fastify.ready()

  await fastify.inject('/')

  t.ok(fastify.casbin.enforce.called)
  const [sub, obj, act] = fastify.casbin.enforce.getCall(0).args
  t.equal(sub, 'a')
  t.equal(obj, 'b')
  t.equal(act, 'c')
})

test('supports passing constants as extractor params with domain', async t => {
  await fastify.register(plugin, {
    hook: 'onRequest',
    getSub: request => request.user,
    getObj: request => request.url,
    getAct: request => request.method,
    getDom: (_request) => 'common'
  })
  fastify.get('/', {
    casbin: {
      rest: {
        getSub: 'a',
        getObj: 'b',
        getAct: 'c',
        getDom: 'users'
      }
    }
  }, () => 'ok')
  fastify.casbin.enforce.resolves(false)
  await fastify.ready()

  await fastify.inject('/')

  const [sub, dom, obj, act] = fastify.casbin.enforce.getCall(0).args
  t.equal(sub, 'a')
  t.equal(dom, 'users')
  t.equal(obj, 'b')
  t.equal(act, 'c')
})
