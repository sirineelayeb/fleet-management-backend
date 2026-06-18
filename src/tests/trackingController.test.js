const trackingController = require( '../controllers/trackingController' )
it('should return live tracking data', async () => {
  const req = {
    user: {
      role: 'admin'
    }
  };

  const res = {
    json: jest.fn()
  };

  await trackingController.getLiveTracking(req, res);

  expect(res.json).toHaveBeenCalled();
});
